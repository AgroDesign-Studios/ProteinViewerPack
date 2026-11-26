// Positive control for check_no_emjs.py: every construct the build must refuse.
// build.sh compiles this as a SIDE_MODULE with the real toolchain and requires
// the checker to exit 1 on it; a checker that passes this is broken.
#include <emscripten.h>
EM_JS(int, js_add, (int a, int b), { return a + b; });
int asm_use(int x) { return EM_ASM_INT({ return $0 * 2; }, x); }
void run_it(void) { emscripten_run_script("console.log(1)"); }
void run_it_async(void) { emscripten_async_run_script("console.log(2)", 0); }
int combo(int a) { return js_add(a, 1) + asm_use(a); }
int plain_add(int a, int b) { return a + b; }
