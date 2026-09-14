package expo.modules.ghostexnative

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper

/** Route changes trigger a health check, including Tailscale VPN appearance/disappearance. */
internal class GhostexNetworkObserver(context: Context, onChanged: () -> Unit) {
  private val manager = context.getSystemService(ConnectivityManager::class.java)
  private val handler = Handler(Looper.getMainLooper())
  private val notify = Runnable { onChanged() }
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = changed()
    override fun onLost(network: Network) = changed()
    private fun changed() {
      handler.removeCallbacks(notify)
      handler.postDelayed(notify, 750)
    }
  }

  init {
    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
      .build()
    manager.registerNetworkCallback(request, callback)
  }

  fun close() {
    manager.unregisterNetworkCallback(callback)
    handler.removeCallbacks(notify)
  }
}
