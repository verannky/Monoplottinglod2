// src/App.js
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import CesiumViewer from "./CesiumViewer";
import ZoomBuilding from "./ZoomBuilding";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CesiumViewer />} />
        <Route path="/zoom/:uid" element={<ZoomBuilding />} />
      </Routes>
    </Router>
  );
}

export default App;
