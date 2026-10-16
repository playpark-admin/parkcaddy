package app.playpark.parkcaddy;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

/** Screen-space instruction graphics, never presented as reconstructed terrain. */
final class GuideOverlayView extends View {
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path path = new Path();
  private final RectF rect = new RectF();
  private final DashPathEffect dashed = new DashPathEffect(new float[]{10, 9}, 0);
  private ScanGuide.State state;
  int topInset, bottomInset;

  GuideOverlayView(Context context) {
    super(context);
    setClickable(false); setFocusable(false);
    // The adjacent status TextView exposes the same instruction to TalkBack.
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
  }
  void setGuide(ScanGuide.State value) { state = value; invalidate(); }
  private float dp(float value) { return value * getResources().getDisplayMetrics().density; }
  private void stroke(int color, float width) {
    paint.setStyle(Paint.Style.STROKE); paint.setColor(color);
    paint.setStrokeWidth(dp(width)); paint.setStrokeCap(Paint.Cap.ROUND);
    paint.setStrokeJoin(Paint.Join.ROUND); paint.setPathEffect(null);
    paint.setShadowLayer(dp(2), 0, 0, 0xFF102A27);
  }
  @Override protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    ScanGuide.State s = state;
    if (s == null || getWidth() <= 0 || s.action == ScanGuide.Action.NONE) return;
    float left = dp(24), right = getWidth() - dp(24);
    float top = Math.max(topInset, dp(72)) + dp(12);
    float bottom = getHeight() - bottomInset - dp(12);
    if (right <= left || bottom - top < dp(70)) return;
    float cx = (left + right) / 2, cy = top + (bottom - top) * .46f;
    float radius = Math.min(dp(42), (right - left) * .16f);
    // A translucent target bracket is a framing guide, not detected geometry.
    if (s.showToes) {
      float w = Math.min(dp(64), (right - left) * .20f);
      float toeY = bottom - dp(8);
      stroke(0xFFF1F9F5, 3);
      drawToe(canvas, cx - w * 1.25f, toeY, w);
      drawToe(canvas, cx + w * 1.25f, toeY, w);
      stroke(0xFFD7F5EC, 2); paint.setPathEffect(dashed);
      rect.set(cx - radius * 1.7f, cy - radius, cx + radius * 1.7f, cy + radius);
      canvas.drawRoundRect(rect, dp(12), dp(12), paint);
      paint.setPathEffect(null);
      if (s.phase == ScanGuide.Phase.BASELINE) {
        rect.set(cx - radius * .6f, cy - radius * .6f, cx + radius * .6f, cy + radius * .6f);
        stroke(0x663FE1B5, 4); canvas.drawArc(rect, -90, 360, false, paint);
        stroke(0xFF7CF0D0, 4); canvas.drawArc(rect, -90, 360 * s.progress, false, paint);
      }
      return;
    }
    if (s.action == ScanGuide.Action.TILT_UP || s.action == ScanGuide.Action.TILT_DOWN) {
      boolean up = s.action == ScanGuide.Action.TILT_UP;
      float sign = up ? -1 : 1;
      float y0 = cy - sign * radius, y1 = cy + sign * radius;
      stroke(0xFF90E7FA, 5);
      path.reset(); path.moveTo(cx - radius * .7f, y0);
      path.cubicTo(cx + radius, y0, cx + radius, y1, cx + radius * .25f, y1);
      canvas.drawPath(path, paint);
      arrowHead(canvas, cx + radius * .25f, y1, -.4f, sign, dp(15));
      drawPhone(canvas, cx - radius, cy, up ? -22 : 22);
    } else if (s.action == ScanGuide.Action.TRANSLATE) {
      float span = Math.min((right - left) * .35f, dp(100));
      stroke(0xFF90E7FA, 4);
      canvas.drawLine(cx - span, cy, cx + span, cy, paint);
      arrowHead(canvas, cx - span, cy, -1, 0, dp(15));
      arrowHead(canvas, cx + span, cy, 1, 0, dp(15));
      drawPhone(canvas, cx, cy - dp(42), 0);
      // Filled length is measured camera baseline, not an animation/countdown.
      stroke(0x667B9895, 5);
      float barY = cy + dp(38);
      canvas.drawLine(cx - span, barY, cx + span, barY, paint);
      stroke(0xFF7CF0D0, 5);
      canvas.drawLine(cx - span, barY, cx - span + 2 * span * s.progress, barY, paint);
    } else if (s.action == ScanGuide.Action.REOBSERVE) {
      stroke(0xFFFFD28A, 3); paint.setPathEffect(dashed);
      rect.set(cx - radius * 1.6f, cy - radius, cx + radius * 1.6f, cy + radius);
      canvas.drawRoundRect(rect, dp(12), dp(12), paint); paint.setPathEffect(null);
      canvas.drawLine(cx, cy - dp(15), cx, cy + dp(4), paint);
      canvas.drawPoint(cx, cy + dp(15), paint);
    } else if (s.action == ScanGuide.Action.WAIT) {
      stroke(0xFF8AC8B9, 3);
      for (int i = -1; i <= 1; i++) canvas.drawCircle(cx + dp(i * 18), cy, dp(4), paint);
    }
  }
  private void drawToe(Canvas canvas, float cx, float y, float width) {
    // Only the rounded front of a shoe is shown; no sole/heel silhouette.
    path.reset(); path.moveTo(cx - width / 2, y);
    path.cubicTo(cx - width / 2, y - width * .75f,
        cx + width / 2, y - width * .75f, cx + width / 2, y);
    canvas.drawPath(path, paint);
  }
  private void drawPhone(Canvas canvas, float cx, float cy, float degrees) {
    canvas.save(); canvas.rotate(degrees, cx, cy);
    stroke(0xFFEAF7F1, 2.5f);
    rect.set(cx - dp(11), cy - dp(21), cx + dp(11), cy + dp(21));
    canvas.drawRoundRect(rect, dp(4), dp(4), paint);
    canvas.drawLine(cx - dp(3), cy + dp(15), cx + dp(3), cy + dp(15), paint);
    canvas.restore();
  }
  private void arrowHead(Canvas canvas, float x, float y, float dx, float dy, float length) {
    float norm = (float) Math.hypot(dx, dy); dx /= norm; dy /= norm;
    canvas.drawLine(x, y, x - dx * length + dy * length * .55f,
        y - dy * length - dx * length * .55f, paint);
    canvas.drawLine(x, y, x - dx * length - dy * length * .55f,
        y - dy * length + dx * length * .55f, paint);
  }
}
