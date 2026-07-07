import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { InvoiceStoreProvider } from "./data/InvoiceStore.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InvoiceStoreProvider>
          <App />
        </InvoiceStoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
