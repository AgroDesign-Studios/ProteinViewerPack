// numpy ABI probe (TN0110 D13). compile.sh compiles this with -fsyntax-only,
// using the SAME $INCS/$DEFS/$FLAGS it builds every PyMOL TU with, before the
// TU loop. An earlier build found every TU seeing the host x86_64 numpy config
// (NPY_SIZEOF_LONG=8) while sizeof(long) is 4 on wasm32; each assert below
// fails in that state, and compile.sh also checks via -H that every numpy
// header resolved under $NPINC (the sha-checked wasm wheel's include dir).
#include <Python.h>
#define NPY_NO_DEPRECATED_API NPY_1_7_API_VERSION
#include <numpy/arrayobject.h>
#include <cstdint>

static_assert(sizeof(long) == 4, "not compiling for wasm32");
static_assert(NPY_SIZEOF_LONG == sizeof(long), "numpy config is not the wasm32 one (NPY_SIZEOF_LONG)");
static_assert(NPY_SIZEOF_INTP == sizeof(npy_intp), "numpy config is not the wasm32 one (NPY_SIZEOF_INTP)");
static_assert(NPY_SIZEOF_PY_INTPTR_T == sizeof(intptr_t), "numpy config is not the wasm32 one (NPY_SIZEOF_PY_INTPTR_T)");
static_assert(sizeof(npy_intp) == 4, "npy_intp is not 4 bytes on wasm32");
static_assert(sizeof(npy_int64) == 8, "npy_int64 is not 8 bytes");
static_assert(NPY_BITSOF_LONG == 32, "numpy believes long is not 32-bit");
