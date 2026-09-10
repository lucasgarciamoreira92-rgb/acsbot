import { createRoot } from "react-dom/client";
import Console from "../app/console";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<Console localMode />);
