// pymolweb spike shim: stands in for Schrodinger's private os_gl_es.h.
// Target surface = OpenGL ES 3.0 (WebGL2) headers from emscripten's sysroot.
#pragma once
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h>
#include "gl_legacy_stub.h"

// Legacy desktop capabilities (GL_LIGHTING, GL_FOG, ...) are stubbed to 0x9000-0x90FF in
// gl_legacy_stub.h; WebGL rejects them with INVALID_ENUM, which PyMOL's next glGetError()
// then misattributes (e.g. "GenericBuffer::genBuffer failed"). Drop them here.
static inline int pymolweb_cap_ok(GLenum c) { return !(c >= 0x9000 && c <= 0x90FF); }
static inline void pymolweb_glEnable(GLenum c) { if (pymolweb_cap_ok(c)) glEnable(c); }
static inline void pymolweb_glDisable(GLenum c) { if (pymolweb_cap_ok(c)) glDisable(c); }
#define glEnable pymolweb_glEnable
#define glDisable pymolweb_glDisable

// Query/pixel-store names WebGL1 rejects with INVALID_ENUM: the 0x90xx legacy stubs, and the
// ES3-only (UN)PACK_ROW_LENGTH / SKIP_ROWS / SKIP_PIXELS that PyMOLReadPixels saves/restores.
// A rejected name leaves a sticky error that makes the next GLGenBuffer() bail out
// (CheckGLErrorOK), i.e. a representation silently loses its VBO.
static inline int pymolweb_pname_ok(GLenum p) {
  if (p >= 0x9000 && p <= 0x90FF) return 0;
  switch (p) { case 0x0CF2: case 0x0CF3: case 0x0CF4: case 0x0D02: case 0x0D03: case 0x0D04: return 0; }
  return 1;
}
static inline void pymolweb_glGetIntegerv(GLenum p, GLint* v) { if (pymolweb_pname_ok(p)) glGetIntegerv(p, v); else *v = 0; }
static inline void pymolweb_glGetFloatv(GLenum p, GLfloat* v) { if (pymolweb_pname_ok(p)) glGetFloatv(p, v); else *v = 0.f; }
static inline void pymolweb_glGetBooleanv(GLenum p, GLboolean* v) { if (pymolweb_pname_ok(p)) glGetBooleanv(p, v); else *v = 0; }
static inline void pymolweb_glPixelStorei(GLenum p, GLint v) { if (pymolweb_pname_ok(p)) glPixelStorei(p, v); }
#define glGetIntegerv pymolweb_glGetIntegerv
#define glGetFloatv pymolweb_glGetFloatv
#define glGetBooleanv pymolweb_glGetBooleanv
#define glPixelStorei pymolweb_glPixelStorei

// WebGL1 requires internalformat == format; PyMOL passes sized GL_RGBA8/GL_RGB8 (ES3 style).
static inline void pymolweb_glTexImage2D(GLenum t, GLint l, GLint ifmt, GLsizei w, GLsizei h, GLint b, GLenum f, GLenum ty, const void* d) {
  if (ifmt == 0x8058) ifmt = GL_RGBA; else if (ifmt == 0x8051) ifmt = GL_RGB;
  glTexImage2D(t, l, ifmt, w, h, b, f, ty, d);
}
#define glTexImage2D pymolweb_glTexImage2D

// Zero-sized glyphs (e.g. ' ') arrive with a null pointer; WebGL rejects that with INVALID_VALUE.
static inline void pymolweb_glTexSubImage2D(GLenum t, GLint l, GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLenum ty, const void* d) {
  if (w <= 0 || h <= 0 || !d) return;
  glTexSubImage2D(t, l, x, y, w, h, f, ty, d);
}
#define glTexSubImage2D pymolweb_glTexSubImage2D
