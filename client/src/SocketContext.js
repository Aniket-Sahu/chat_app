import React, { createContext } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  autoConnect: false,
    auth: {
      serverOffset: 0
    },
    ackTimeout: 10000,
    retries: 3,
});

export const SocketContext = createContext(socket);

export const SocketProvider = ({children}) => {
    return <SocketContext.Provider value ={socket}>{children}</SocketContext.Provider>
}