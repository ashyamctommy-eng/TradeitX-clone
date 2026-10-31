'use client';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      `${window.location.protocol}//${window.location.hostname}:4000`;
    socket = io(url, { withCredentials: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}
