import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { PLAYER_TOO_LESS, GAME_START, REPEAT_JOIN, ROOM_PLAYING, ROOM_FULL, JOIN_ROOM_EXIST, CREATE_ROOM_EXIST } from 'src/constant';

@WebSocketGateway({ cors: true })
export class EventGateway {
  @WebSocketServer() private server: Server;

  private limitClientNum: number = 4;

  private globalGameRoom: Map<string, GameRoom> = new Map();

  private broadcast2Others = (roomName: string, clientId: string, msg: string) => {
    this.server
      .to(roomName as string)
      .except(clientId)
      .emit('broadcast', { msg: msg }); //  给当前房间除了自己的人广播消息
  }

  private updateRoom = (newRoom: GameRoom, player: Player) => {
    // const newPlayer: Player = {
    //   name: playerName,
    //   id: playerName, //  找机会改成使用传入的player用户名
    //   socketId: clientId,
    // };
    newRoom.playerMap.set(player.id, player);
  }

  private updateRoomList = (): RoomInfo[] => {
    let roomList = [];
    for (let room of this.globalGameRoom) {
      roomList.push(room[1]);
    }
    roomList = roomList.map((room: GameRoom): RoomInfo => {
      return {
        ...room,
        playerNum: room.playerMap.size,
        playerLst: Array.from(room.playerMap.values()),
        owner: room.owner
      }; //  验证正确后去掉 playerMap 属性
    });
    return roomList;
  }

  @SubscribeMessage('connect-server')
  handleConnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): RoomInfo[] {
    console.log('new client connected.', client.id);
    return this.updateRoomList(); //  每个客户端接入时，自动获取一次房间列表
  }

  @SubscribeMessage('update-roomlist')
  handleUpdateRoomList(): void {
    console.log('update.');
    this.server.sockets.emit('get-new-room-list', this.updateRoomList()); //  通知所有客户端获取新房间列表
    // this.server.of('/').emit('get-new-room-list', this.updateRoomList()); 
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CreateRoomReq,
  ): CreateRoomRes {
    console.log('createRoom');
    console.log(client.rooms);
    // client.broadcast.emit('event', {str:'afdsafda'});
    if (this.server.of('/').adapter.rooms.has(data.roomName)) {
      return CREATE_ROOM_EXIST;
    }
    client.join(data.roomName); //  创建时自动加入房间

    const newPlayer: Player = data.owner;
    // { //  房主在创建时更新进入 globalGameRoom
    //   name: client.id,
    //   id: client.id, //  找机会改成使用传入的player用户名
    //   socketId: client.id,
    // };
    let newRoom: GameRoom = {
      name: data.roomName,
      owner: newPlayer,
      started: false,
      message: new Map(),
      playerMap: new Map(),
    };
    newRoom.playerMap.set(newPlayer.id, newPlayer);
    this.globalGameRoom.set(data.roomName, newRoom);
    console.log(client.rooms);
    console.log(this.globalGameRoom);
    return {
      success: true,
      room: newRoom,
      msg: '创建成功!'
    };
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() joinRoomReq: JoinRoomReq
  ): JoinRoomRes {
    const { roomName, player } = joinRoomReq;
    console.log('joinRoom');
    const roomsMap = this.server.of('/').adapter.rooms;
    console.log('of room', roomsMap);
    console.log('set room', roomName, roomsMap.get(roomName));

    if (roomsMap.get(roomName) === undefined) {
      //  if incoming room_id not in exist rooms, return null
      console.log('no has');
      return JOIN_ROOM_EXIST;
    } else if (roomsMap.get(roomName).size >= this.limitClientNum + 1) {
      // room 人数超过4, 拒绝加入(+1是计入初始的一个房间, 这里没找到namespace的api，先这样写)
      console.log('size', roomsMap.get(roomName).size);
      return ROOM_FULL;
    } else if (this.globalGameRoom.get(roomName).started) {
      return ROOM_PLAYING;
    } else if (this.server.of('/').adapter.rooms.get(roomName).has(player.id)) {
      return REPEAT_JOIN;
    }
    client.join(roomName);
    this.updateRoom(this.globalGameRoom.get(roomName), player);
    this.broadcast2Others(roomName, client.id, `${player.name}已进入房间`); //  给当前房间除了自己的人广播消息
    return {
      msg: `已加入房间：${roomName}`,
      success: true,
      room: this.globalGameRoom.get(roomName)
    }; //  if exist, return room info
  }

  @SubscribeMessage('leaveRoom')  //  玩家手动离开房间（不通过调用 handleDisconnect 实现了）
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() leaveRoomReq: LaveRoomReq,
  ): any {
    console.log('leaveRoom');
    const rooms = this.globalGameRoom;
    const { player, room } = leaveRoomReq;

    const curRoom = rooms.get(room.name);
    // console.log('curRoom1', this.server.of('/').adapter.rooms.get(room.name));
    if (curRoom.owner.id === player.id) { //  是房主
      console.log('是房主');
      //  TODO: 随机安排一个玩家为房主 or 房间解散？
      if (room.playerMap.size > 1) {

      } else {
        this.globalGameRoom.delete(curRoom.name);
        this.server.of('/').adapter.rooms.delete(curRoom.name); //  从实际 socket 中删除
      }
    } else if (curRoom.playerMap.has(player.id)) { //  若是普通玩家离开，注意处理给其它玩家的通知（TODO）
      console.log('是普通玩家');
      curRoom.playerMap.delete(player.id);
      client.leave(curRoom.name);
      this.broadcast2Others(curRoom.name, client.id, `${player.name}已离开房间`); //  给当前房间除了自己的人广播消息
    }
    // console.log('curRoom2', this.server.of('/').adapter.rooms.get(room.name));
    this.handleUpdateRoomList();
    return true;
  }

  @SubscribeMessage('event')
  handleEvent(@MessageBody() data: any): any {
    console.log('call event');
    return data;
  }

  @SubscribeMessage('handleStart')
  handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): StartInfo {
    console.log('handleStart');
    // this.globalGameRoom.get(data.roomName)
    if (this.server.of('/').adapter.rooms.get(data.roomName).size < 2) {
      return PLAYER_TOO_LESS;
    }
    return GAME_START;
  }

  /**
   * 断开链接
   */
  handleDisconnect(client: Socket, manually: Boolean | undefined) {
    console.log('disconnect', client.id, client.data);
    console.log('client', client.handshake.auth);
    const loginPlayerInfo = client.handshake.auth;
    const playerId = loginPlayerInfo.id;

    /*  
      重大问题！！！ 
      1、刷新页面导致断连和重连
        - 保存当前状态（both 前/后端），并且不适用 client 的 socket id 作为房间和人的唯一标识，应当使用玩家 id
        - 先创建前端的 redux
        - 需要记录的状态：加入的房间、游戏的进度、登陆的状态
      2、handleDisconnect 函数执行时，client 已经销毁，无法通过 id 拿到房间信息来更新 globalGameRoom
        - 通过 client.id 直接在 globalGameRoom 里遍历房间和 playerMap 查找，然后删除
      3、刷新和主观地退出房间，都会调用本函数，需要在逻辑上做出区别
        - 主观退出的情况：1）关闭网页 2）手动点击离开房间
        - 对于 1），可能不存在 reconnect 的情况，直接不用管，虽然可能已经记录了状态，但无故退出导致游戏结束，不需要考虑恢复
        - 对于 2），用一个 handleLeave 的函数监听客户端，执行时调用本函数
      
      TODOS
      1、先完成前端页面刷新，断连时相关 globalGameRoom 清除的逻辑
      2、实现以用户 id 作为房间和用户标识【已解决, 待检查】
      2、然后实现断连状态记录恢复的逻辑

      现状：
      1、玩家的 id 已经是数据库分配的 uid（发送 create 和 join 请求时传过来的），而不是 client.id，
          但 room.playerMap 里还没改过来，仍然是 client.id
      2、加入房间后刷新，就退出房间了（前后端都显示如此）
      3、这里断连仍然是用 client.id 查找，肯定会出问题，但不知道该函数如何获取断连的用户的 player uid
      【已解决】：方法：后端的 Socket 对象有data属性，但前端没有，无法利用，但前后端都有身份验证 auth 属性
        在前端登陆后，进入 menu 页时创建 socket 连接，此时在前端给 auth 写入用户信息，后端就能在 client 参数中，
        通过 client.handshake.auth 获取断开连接的 player 对象.
    */
    const rooms = this.globalGameRoom;
    console.log('rooms', rooms);

    if (true) {  // 测试时为true，之后应该为 manually，此处是处理用户手动退出的
      for (const roomName of rooms.keys()) {
        const room = rooms.get(roomName);
        if (room.owner.id === playerId) { //  是房主
          console.log('是房主');
          //  TODO: 随机安排一个玩家为房主
          if (room.playerMap.size > 1) {

          } else {
            this.globalGameRoom.delete(roomName);
          }
        } else if (room.playerMap.has(playerId)) { //  若是普通玩家离开，注意处理给其它玩家的通知（TODO）
          console.log('是普通玩家');
          room.playerMap.delete(playerId);
        }
      }
    }
    this.handleUpdateRoomList();
  }
}
