package com.goodness.flash;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private FlashHttpServer flashHttpServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        flashHttpServer = new FlashHttpServer(this);

        try {
            flashHttpServer.start();
            android.util.Log.d("Flash", "Android receiver started on port 45678");
        } catch (Exception e) {
            android.util.Log.e("Flash", "Failed to start Android receiver", e);
        }
    }

    @Override
    public void onDestroy() {
        if (flashHttpServer != null) {
            flashHttpServer.stop();
        }
        super.onDestroy();
    }
}
