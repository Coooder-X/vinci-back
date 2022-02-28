import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class EventGateway {
  @WebSocketServer() private server: Server;
  private limitClientNum: number = 4;

  @SubscribeMessage('connect-server')
  handleConnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): void {
    console.log('new client connected.');
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): any {
    console.log('createRoom');
    console.log(client.rooms);
    // client.broadcast.emit('event', {str:'afdsafda'});
    client.join(data.roomName);
    this.server
      .to(data.roomName as string)
      .emit('broadcast', { str: 'afdsafda' });
    console.log(client.rooms);
    return data;
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): any {
    console.log('joinRoom');
    const roomsMap = this.server.of('/').adapter.rooms;
    console.log('of room', roomsMap);
    console.log('set room', data.roomId, roomsMap.get(data.roomId));

    if (roomsMap.get(data.roomId) === undefined) {
      //  if incoming room_id not in exist rooms, return null
      console.log('no has');
      return null;
    } else if (roomsMap.get(data.roomId).size >= this.limitClientNum + 1) {
      // room 人数超过4, 拒绝加入(+1是计入初始的一个房间, 这里没找到namespace的api，先这样写)
      console.log('size', roomsMap.get(data.roomId).size);
      return { msg: '当前房间人数已满' };
    }
    client.join(data.roomId);
    this.server
      .to(data.roomId as string)
      .except(client.id)
      .emit('broadcast', { msg: `${client.id}已进入房间` });  //  给当前房间除了自己的人广播消息
    return { msg: `已加入房间：${data.roomId}` }; //  if exist, return room info
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): any {
    console.log('leaveRoom');
    return data;
  }

  @SubscribeMessage('event')
  handleEvent(@MessageBody() data: any): any {
    console.log('call event');
    return data;
  }

  @SubscribeMessage('func')
  func(@MessageBody() data: string): string {
    console.log('func');
    this.server.on('connection', (socket: Socket) => {
      // console.log(socket);
      socket.emit('message');
    });
    return data;
  }

  /**
   * 断开链接
   */
  handleDisconnect(client: Socket) {
    console.log('disconnect');
    // this.allNum -= 1
    // this.ws.emit('leave', { name: this.users[client.id], allNum: this.allNum, connectCounts: this.connectCounts });
  }
}
