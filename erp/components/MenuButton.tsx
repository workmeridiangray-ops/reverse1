"use client";
export function MenuButton() {
  return <button type="button" className="btn sm menu-btn" aria-label="Open navigation menu" onClick={() => document.body.classList.toggle("nav-open")}>☰ Menu</button>;
}
export function NavCloser() {
  return <button type="button" className="btn sm ghost menu-btn" aria-label="Close navigation menu" onClick={() => document.body.classList.remove("nav-open")}>✕ Close</button>;
}
