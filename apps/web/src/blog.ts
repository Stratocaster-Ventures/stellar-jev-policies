import "./style.css";
import "./blog.css";
import { decrypt, spotlight } from "./fx";
document.querySelectorAll<HTMLElement>("[data-decrypt]").forEach((el) => decrypt(el));
spotlight(".post table, .post .callout, .card");
