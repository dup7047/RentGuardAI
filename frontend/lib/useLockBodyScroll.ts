import { useEffect } from 'react';

// Locks the page from scrolling while a modal is open. Uses position:fixed
// on <body> (rather than overflow:hidden) so it works even when <html> is
// the scrolling root and on iOS Safari, where overflow:hidden on body is
// often ignored.
export function useLockBodyScroll() {
  useEffect(() => {
    const scrollY = window.scrollY;
    const { body } = document;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, []);
}
