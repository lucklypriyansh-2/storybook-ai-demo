export const E = {
  std: [0.2, 0.8, 0.2, 1] as const, enter: [0.16, 1, 0.3, 1] as const, exit: [0.7, 0, 0.84, 0] as const,
  bounce: [0.34, 1.56, 0.64, 1] as const, page: [0.645, 0.045, 0.355, 1] as const,
};
export const D = { instant: 0.1, fast: 0.18, base: 0.28, slow: 0.45, page: 0.7, reveal: 1.4 };
export const img = (f: string) => `${import.meta.env.BASE_URL}images/${f}`;
