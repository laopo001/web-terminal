import { useEffect } from 'react';

export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (viewport.scale !== 1) return;
      document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--app-top', `${viewport.offsetTop}px`);
    };
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--app-height'); document.documentElement.style.removeProperty('--app-top');
    };
  }, []);
}
