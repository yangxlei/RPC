# RPC
A Rpc API for react-native. 

# demo
```JavaScript
const factory = createRpcFactory('http://abc.cn/');
factory.createRpc('userInfo', { userId: 1234})
  .get<DataType>()
   .then((data: DataType) => {})
   .catach((err: Error) => {})
 ```
