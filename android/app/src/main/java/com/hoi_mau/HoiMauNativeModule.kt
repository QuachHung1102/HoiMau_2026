package com.hoi_mau

import android.content.ClipData
import android.content.Intent
import android.view.WindowManager
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import java.io.File

class HoiMauNativeModule(reactContext: ReactApplicationContext) : NativeHoiMauNativeSpec(reactContext) {

  override fun getName() = NAME

  override fun setKeepAwake(on: Boolean) {
    UiThreadUtil.runOnUiThread {
      val window = reactApplicationContext.currentActivity?.window ?: return@runOnUiThread
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  override fun shareTextFile(fileName: String, mimeType: String, content: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      val dir = File(context.cacheDir, "exports")
      dir.mkdirs()
      dir.listFiles()?.forEach { it.delete() }
      // Keep only the last path segment: the name comes from JS and must not leave exports/.
      val file = File(dir, File(fileName).name.ifEmpty { "export.txt" })
      file.writeText(content, Charsets.UTF_8)
      val uri = FileProvider.getUriForFile(context, AUTHORITY, file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri(file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, file.name).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val activity = context.currentActivity
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_SHARE", e.message, e)
    }
  }

  companion object {
    const val NAME = "HoiMauNative"
    const val AUTHORITY = "com.hoi_mau.fileprovider"
  }
}
