const TIME_OUT_FETCH: number = 60000;

enum RpcErrorCode {
    ERR_RPC_UNKNOWN = -1, // unknown
    ERR_RPC_CANCELED = -2, // rpc 已取消
    ERR_RPC_EXECUTED = -3, // rpc 已执行过
    ERR_RPC_TIMEOUT = -4, // 请求超时
    ERR_RPC_JSON_RESOLVE = -5, // json 解析错误
}

/**
 * Rpc 错误结果
 */
class RpcError extends Error {
    public code: number = RpcErrorCode.ERR_RPC_UNKNOWN;
    public data: any = null;

    constructor(code: number = RpcErrorCode.ERR_RPC_CANCELED, message: string = "请求已取消", data: any = null) {
        super(message);
        this.name = "RpcError";
        this.code = code;
        this.data = data;
    }
}

interface IRequestParams {
    [name: string]: string;
}

interface IRequestBody {
    contentType: string;
    body: BodyInit_;
}

function formUrlEncodeSerialize(params: IRequestParams): IRequestBody {
    let result = new Array<string>();
    Object.keys(params).forEach((key: string) => {
        result.push(`${key}=${encodeURI(params[key])}`);
    });

    return {
        contentType: "application/x-www-form-urlencoded",
        body: result.join("&")
    }
}

function multiPartSerialize(params: IRequestParams): IRequestBody {
    const formData = new FormData();
    Object.keys(params).forEach((key: string) => {
        formData.append(key, params[key]);
    });
    return {
        contentType: "multipart/form-data",
        body: formData
    };
}

interface RpcResult {
    errno: number;
    errmsg: string;
    data: any;
}

function responseJsonDeserialize(response: Response): Promise<any> {
    return new Promise((resolve, reject) => {
        response.json()
            .then((result: RpcResult) => {
                if (result.errno !== 0) {
                    reject(new RpcError(result.errno, result.errmsg, result));
                } else {
                    resolve(result.data);
                }
            })
            .catch((err: Error) => {
                reject(new RpcError(RpcErrorCode.ERR_RPC_JSON_RESOLVE, `数据解析错误(${err.message})`));
            });
    });
}

class Rpc {
    private host: string;
    private api: string;
    private requestParams: IRequestParams;
    private headers: IRequestParams;
    private canceled: boolean = false;
    private executed: boolean = false;

    constructor(host: string, api: string, params?: IRequestParams, headers?: IRequestParams) {
        this.host = host;
        this.api = api;
        this.requestParams = params || {};
        this.headers = headers || {};
    }

    /**
     * Rpc Get
     * 
     * @param timeout rpc 超时时间， 默认 10s， @see TIME_OUT_FETCH
     * @param deserialize response 反序列化函数. 默认使用 json 反序列化. @see responseJsonDeserialize
     */
    get<T>(timeout: number = TIME_OUT_FETCH, deserialize: ((response: Response) => Promise<any>) = responseJsonDeserialize): Promise<T> {
        let _params = Object.assign({}, this.requestParams, { "timestamp": `${Math.round(Date.now() / 1000)}` });
        let requestBody = formUrlEncodeSerialize(_params);

        let _headers = {
            'Accept': 'application/json, text/plain, */*',
            ...this.headers
        };

        let opts = {
            method: "GET",
            headers: _headers,
        };

        let request = new Request(`${this.host}${this.api}?${requestBody.body}`, opts);
        return this.execute(timeout, request, deserialize);
    }

    /**
     * Rpc Post
     * 
     * @param timeout rpc 超时时间，默认 10s， @see TIME_OUT_FETCH
     * @param serialize  request 参数序列化函数。默认采用 form-url-encode 方式。 @see formUrlEncodeSerialize
     * @param deserialize response 反序列化函数. 默认使用 json 反序列化. @see responseJsonDeserialize     
     */
    post<T>(timeout: number = TIME_OUT_FETCH,
        serialize: ((params: {}) => IRequestBody) = formUrlEncodeSerialize,
        deserialize: ((response: Response) => Promise<any>) = responseJsonDeserialize): Promise<T> {

        let _params = Object.assign({}, this.requestParams, { "timestamp": `${Math.round(Date.now() / 1000)}` });
        let requestBody = serialize(_params);

        let _headers = {
            "Content-Type": requestBody.contentType,
            'Accept': 'application/json, text/plain, */*',
            ...this.headers
        };

        let opts = {
            method: "POST",
            headers: _headers,
            body: requestBody.body,
        };

        let request = new Request(`${this.host}${this.api}`, opts);
        return this.execute(timeout, request, deserialize);
    }

    cancel(): void {
        this.canceled = true;
    }

    isExecuted(): boolean {
        return this.executed;
    }

    isCanceled(): boolean {
        return this.canceled;
    }

    clone(): Rpc {
        return new Rpc(this.host, this.api, this.requestParams, this.headers);
    }

    private execute<T>(timeout: number, request: Request, deserialize: ((response: Response) => Promise<any>)): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.isExecuted()) {
                reject(new RpcError(RpcErrorCode.ERR_RPC_EXECUTED, "请求已执行!"));
            } else {
                this.executed = true;

                if (this.isCanceled()) {
                    reject(new RpcError());
                } else {
                    const timeoutHD = setTimeout(() => {
                        reject(new RpcError(RpcErrorCode.ERR_RPC_TIMEOUT, "请求超时"));
                    }, timeout);

                    fetch(request)
                        .then((response: Response) => {
                            clearTimeout(timeoutHD);
                            if (this.isCanceled()) {
                                reject(new RpcError());
                            } else {
                                if (response.ok) {
                                    return deserialize(response);
                                } else {
                                    reject(new RpcError(response.status, response.statusText));
                                }
                            }
                        })
                        .then((data: any) => {
                            resolve(data as T);
                        })
                        .catch((err: Error) => {
                            clearTimeout(timeoutHD);
                            //@ts-ignore
                            reject(new RpcError(err.code === undefined ? RpcErrorCode.ERR_RPC_UNKNOWN : err.code, err.message, err.data === undefined ? null : err.data));
                        })
                }
            }
        });
    }
}

class RpcFactory {
    private readonly host: string;

    constructor(host: string) {
        this.host = host;
    }

    /**
     * @param api 请求地址 path 部分
     * @param params 请求参数
     * @param headers 自定义请求头
     * @returns @see Rpc
     */
    createRpc = (api: string, params?: IRequestParams, headers?: IRequestParams): Rpc => {
        return new Rpc(this.host, api, params, headers);
    }
}

/**
 * RpcFactory 构造器
 * 
 * @param host 服务器域名
 * @returns @see RpcFactory
 */
function createRpcFactory(host: string): RpcFactory {
    return new RpcFactory(host);
}

export {
    RpcFactory,
    createRpcFactory,
    Rpc,
    RpcError,
    RpcErrorCode,
    IRequestParams,
    IRequestBody,
    formUrlEncodeSerialize,
    multiPartSerialize,
    responseJsonDeserialize
}
