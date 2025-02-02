import React, { useContext, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { SocketContext } from "../SocketContext";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [currentFriend, setCurrentFriend] = useState(null);
  const socket = useContext(SocketContext);
  const [sessionUser, setSessionUser] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchAuthStatus = async () => {
      const res = await fetch("http://localhost:3000/auth-status", {
        credentials: "include",
      });
      const data = await res.json();
      if (data.authenticated) {
        setSessionUser(data.user);
      }
    };

    fetchAuthStatus();
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("http://localhost:3000/users", {
          credentials: "include",
          method: "GET"
        });
        const data = await res.json();
        setUsers(data);
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    }

    fetchUsers();

    if (!socket) {
      console.error("Socket is not available");
      return;
    }
    socket.connect();

    // Handle incoming chat messages
    const handleMessage = (msg) => {
      setMessages((prev) => {
        if (!prev.some((m) => m.id === msg.id)) {
          return [...prev, msg]; 
        }
        return prev;
      });
    };

    socket.on("chat message", handleMessage);

    // Cleanup function to remove the event listener
    return () => {
      socket.off("chat message");
      socket.off("connect");
      socket.off("disconnect");  // Disconnect socket when the component unmounts
    };
  }, [socket]); // Only re-run the effect if `socket` changes

  useEffect(() => {
    if (!currentFriend?.id) {
      setMessages([]); 
      return;
    }

    if (!currentFriend?.id) return;
    const getMessages = async () => {
      try {
        const res = await fetch(`http://localhost:3000/messages/${currentFriend.id}`, {
          credentials: "include",
          method: "GET"
        });
        const data = await res.json();
        setMessages(data);
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    };

    getMessages();
  }, [currentFriend]);


  const handleLogout = async () => {
    await fetch("http://localhost:3000/logout", {
      method: "POST",
      credentials: "include",
    });
    navigate("/login");
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socket && currentFriend?.id) {
      socket.emit(
        "chat message",
        { text: message, receiverId: currentFriend.id },
        (error) => {
          if (error) {
            console.error("Failed to send message:", error);
          } else {
            setMessage("");
          }
        }
      );
    }
  };
  
  return (
    <div className="chat-container">
      <div className="sidebar">
        <h3>Users</h3>
        {users.map((user, index) => (
          <div
            key={index}
            className="user-item"
            onClick={() => setCurrentFriend(user)}
          >
            {user.username}
          </div>
        ))}
      </div>
      <div className="chat-main">
        <div className="chat-header">
          <h2>{currentFriend ? currentFriend.username : "Select a friend"}</h2>
        </div>
        <div className="chat-messages">
          {messages.map((msg, index) => {
            const isSelf = msg.sender_id === sessionUser?.id;
            return (
              <div
                key={index}
                className={`chat-message ${isSelf ? "self" : "friend"}`}
              >
                {msg.text}
              </div>
            );
          })}
        </div>
        <div className="chat-input">
          <form onSubmit={sendMessage}>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message"
              aria-label="Type a message"
            />
            <button type="submit" disabled={!message.trim()}>
              Send
            </button>
          </form>
        </div>
        <button className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}

export default App;