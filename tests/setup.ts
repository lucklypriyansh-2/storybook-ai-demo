import '@testing-library/jest-dom/vitest';
// jsdom lacks these
(globalThis as any).scrollTo = () => {};
window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false })) as any;
(globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
