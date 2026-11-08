"use client";

/**
 * "Skip to main content" link (WCAG 2.4.1 Bypass Blocks). It is the first focusable element on every page
 * and stays off-screen until it receives keyboard focus. Activating it moves focus to the page's <main>,
 * so the next Tab lands on the page content rather than the navigation.
 */
export function SkipLink() {
  function skip(event: React.MouseEvent<HTMLAnchorElement>) {
    const main = document.querySelector("main");
    if (!main) return; // No main landmark on this screen: let the browser handle the link normally.
    event.preventDefault();
    if (!main.id) main.id = "main-content";
    main.setAttribute("tabindex", "-1");
    main.focus();
    main.scrollIntoView();
  }

  return (
    <a href="#main-content" className="skip-link" onClick={skip}>
      Skip to main content
    </a>
  );
}
