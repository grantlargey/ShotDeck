// Bootstraps the React app and wraps the root tree with the 
// router and global styles.
import React from "react";
import ReactDOM from "react-dom/client"; // Used to create a root for the app
import { BrowserRouter } from "react-router-dom"; // Provides client side routing
import App from "./App.jsx";
import "./App.css";

// Create a root container on the element with id="root" and 
// render the React application. 
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
