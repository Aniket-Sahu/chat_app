import { Link } from "react-router-dom";
import React from "react";

const Home = () => {
  return (
    <div className="home-container">
      <h1>Welcome to My chat App</h1>
      <div className="home-buttons">
        <Link to="/login">
          <button aria-label="Login">Login</button>
        </Link>
        <Link to="/register">
          <button aria-label="Register">Register</button>
        </Link>
      </div>
    </div>
  );
};

export default Home;
