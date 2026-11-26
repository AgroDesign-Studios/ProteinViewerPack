// Negative control for check_no_emjs.py: a plain side module the checker must
// pass (exit 0), so a checker that flags everything is caught too.
int plain_add(int a, int b) { return a + b; }
