/// <reference types="vitest" />

// Augment vitest's `expect` with @testing-library/jest-dom matchers
// (toBeVisible / toHaveTextContent / toBeInTheDocument / etc.). The
// runtime side is wired in the test setup (`import '@testing-library/jest-dom/vitest'`);
// this file makes the matcher types visible to `tsc --noEmit` for *.test.tsx
// files.
import '@testing-library/jest-dom/vitest'
