package app.playpark.parkcaddy;

import android.content.Context;
import com.google.ar.core.ArCoreApk;

/** Gates the measurement UI before a session is created. */
final class ArCapability {
  enum Result { SUPPORTED, INSTALL_REQUIRED, UNSUPPORTED }

  static Result check(Context context) {
    ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(context);
    if (availability.isSupported()) return Result.SUPPORTED;
    if (availability.isTransient()) return Result.INSTALL_REQUIRED;
    return Result.UNSUPPORTED;
  }
}
