// Retain the implementation and saved subscriptions for a future release.
// VITE_ENABLE_PODCASTS=true explicitly enables the retained UI and regression suite.
export const FEATURES = { podcasts: import.meta.env.VITE_ENABLE_PODCASTS === "true" };
