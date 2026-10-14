package com.goodness.flash;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

import fi.iki.elonen.NanoHTTPD;

public class FlashHttpServer extends NanoHTTPD {

    private static final String TAG = "FlashHttpServer";
    private static final int PORT = 45678;

    private final File receiveDir;
    private final String pairingCode;
    private final Map<String, Long> pairedTokens = new HashMap<>();

    public FlashHttpServer(Context context) {
        super(PORT);

        this.receiveDir = new File(
                context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                "FlashReceived"
        );

        if (!receiveDir.exists()) {
            receiveDir.mkdirs();
        }

        this.pairingCode = String.format("%06d", new Random().nextInt(900000) + 100000);
        Log.d(TAG, "Pairing code: " + pairingCode);
    }

    public String getPairingCode() {
        return pairingCode;
    }

    private Response jsonResponse(Response.Status status, String body) {
        return newFixedLengthResponse(status, "application/json; charset=utf-8", body);
    }

    private String readRequestBody(IHTTPSession session) throws IOException {
        InputStream input = session.getInputStream();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        byte[] chunk = new byte[4096];
        int read;

        while ((read = input.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }

        return buffer.toString("UTF-8");
    }

    private String getDeviceInfoJson() {
        try {
            JSONObject obj = new JSONObject();
            obj.put("name", android.os.Build.MODEL);
            obj.put("type", "phone");
            obj.put("ip", getLocalIpAddress());
            obj.put("port", PORT);
            obj.put("url", "http://" + getLocalIpAddress() + ":45678");
            return obj.toString();
        } catch (Exception e) {
            return "{\"name\":\"phone\",\"type\":\"phone\"}";
        }
    }

    private String getLocalIpAddress() {
        try {
            for (java.util.Enumeration<java.net.NetworkInterface> en = java.net.NetworkInterface.getNetworkInterfaces(); en.hasMoreElements(); ) {
                java.net.NetworkInterface intf = en.nextElement();
                for (java.util.Enumeration<java.net.InetAddress> enumIpAddr = intf.getInetAddresses(); enumIpAddr.hasMoreElements(); ) {
                    java.net.InetAddress inetAddress = enumIpAddr.nextElement();
                    if (!inetAddress.isLoopbackAddress() && inetAddress instanceof java.net.Inet4Address) {
                        return inetAddress.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "192.168.0.0";
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        try {
            if (method == Method.GET && uri.equals("/health")) {
                return jsonResponse(Response.Status.OK, "{\"ok\":true}");
            }

            if (method == Method.GET && uri.equals("/info")) {
                return jsonResponse(Response.Status.OK, getDeviceInfoJson());
            }

            if (method == Method.GET && uri.equals("/pairing-code")) {
                return jsonResponse(Response.Status.OK, "{\"code\":\"" + pairingCode + "\"}");
            }

            if (method == Method.POST && uri.equals("/pair")) {
                String body = readRequestBody(session);
                JSONObject json = new JSONObject(body);
                String code = json.optString("code", "");

                if (!pairingCode.equals(code)) {
                    return jsonResponse(Response.Status.UNAUTHORIZED, "{\"error\":\"Incorrect pairing code\"}");
                }

                String token = UUID.randomUUID().toString();
                pairedTokens.put(token, System.currentTimeMillis() + 30 * 60 * 1000);

                JSONObject response = new JSONObject();
                response.put("ok", true);
                response.put("token", token);

                return jsonResponse(Response.Status.OK, response.toString());
            }

            if (method == Method.POST && uri.equals("/upload")) {
                String authHeader = session.getHeaders().get("authorization");
                if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                    return jsonResponse(Response.Status.UNAUTHORIZED, "{\"error\":\"Pair with this device before sending files\"}");
                }

                String token = authHeader.substring("Bearer ".length()).trim();
                Long expiration = pairedTokens.get(token);

                if (expiration == null || expiration < System.currentTimeMillis()) {
                    pairedTokens.remove(token);
                    return jsonResponse(Response.Status.UNAUTHORIZED, "{\"error\":\"Pair with this device before sending files\"}");
                }

                Map<String, String> files = new HashMap<>();
                session.parseBody(files);

                if (files.isEmpty()) {
                    return jsonResponse(Response.Status.BAD_REQUEST, "{\"error\":\"No files uploaded\"}");
                }

                int savedCount = 0;
                JSONObject result = new JSONObject();
                result.put("ok", true);

                for (Map.Entry<String, String> entry : files.entrySet()) {
                    String fieldName = entry.getKey();
                    String savedPath = entry.getValue();

                    if ("files".equals(fieldName) || fieldName.startsWith("files")) {
                        File source = new File(savedPath);
                        String fileName = source.getName();
                        String safeName = fileName.replaceAll("[\\/:*?\"<>|]", "_");
                        File destination = new File(receiveDir, safeName);

                        if (source.exists()) {
                            copyFile(source, destination);
                            savedCount++;
                        }
                    }
                }

                result.put("count", savedCount);
                return jsonResponse(Response.Status.OK, result.toString());
            }

            return jsonResponse(Response.Status.NOT_FOUND, "{\"error\":\"Not found\"}");

        } catch (Exception e) {
            Log.e(TAG, "Serve error", e);
            return jsonResponse(Response.Status.INTERNAL_SERVER_ERROR, "{\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    private void copyFile(File source, File destination) throws IOException {
        byte[] buffer = new byte[8192];
        try (InputStream in = new java.io.FileInputStream(source);
             FileOutputStream out = new FileOutputStream(destination)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }
}
