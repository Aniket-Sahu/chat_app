import React from "react";
import ReactDOM from "react-dom/client";
import { SocketProvider } from "./SocketContext"; 
import AppRouter from "./components/approuter";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <SocketProvider> 
        <AppRouter />
    </SocketProvider>
);