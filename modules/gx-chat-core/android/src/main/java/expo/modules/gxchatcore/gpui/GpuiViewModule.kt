package expo.modules.gxchatcore.gpui

import dev.ghostex.gpui.GpuiNative
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * The GPUI chat transcript: the desktop's own chat renderer and Rust chat host, drawn by
 * `libgx_mobile.so` into [GpuiView].
 *
 * `isAvailable()` says whether this build carries it (`packages/gx-chat-mobile/build.sh --gpui`);
 * every other call is only made when it does. `start(config)` launches GPUI once per process and
 * `command(json)` queues a JSON command for it (the protocol is `packages/gpui-mobile/host/src/
 * chat_root.rs`); events come back as the view's `onGpuiEvent`.
 */
class GpuiViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GpuiView")

    Function("isAvailable") {
      GpuiNative.isAvailable
    }

    Function("start") { configJson: String ->
      requireAvailable()
      val context = appContext.reactContext
        ?: throw CodedException("GpuiNoContext", "React context is unavailable.", null)
      val activity = appContext.currentActivity
      val config = try {
        JSONObject(configJson)
      } catch (_: Exception) {
        JSONObject()
      }
      // Dev hook: `adb shell am start -n <pkg>/.MainActivity --es gpuiBackend gles` (or vulkan)
      // limits wgpu to one backend, so the two can be compared on a device.
      activity?.intent?.getStringExtra("gpuiBackend")?.let { config.put("backend", it) }
      BundledFonts.emojiFontPath(context)?.let { config.put("emojiFontPath", it) }
      GpuiNative.nativeStart(activity, context.filesDir.absolutePath, config.toString())
    }

    Function("command") { json: String ->
      requireAvailable()
      GpuiNative.nativeCommand(json)
    }

    OnActivityEntersForeground {
      if (GpuiNative.isAvailable) GpuiNative.nativeResumed()
    }

    OnActivityEntersBackground {
      if (GpuiNative.isAvailable) GpuiNative.nativePaused()
    }

    View(GpuiView::class) {
      Events("onGpuiEvent")

      Prop("surfaceType") { view: GpuiView, type: String? ->
        view.setSurfaceType(type)
      }
    }
  }

  private fun requireAvailable() {
    if (!GpuiNative.isAvailable) {
      throw CodedException(
        "GpuiUnavailable",
        "This build has no GPUI transcript (packages/gx-chat-mobile/build.sh --gpui).",
        null
      )
    }
  }
}
