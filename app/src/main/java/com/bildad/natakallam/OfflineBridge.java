package com.bildad.natakallam;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/** Lets the page keep lecture audio and PDFs on the phone and render PDFs without any external app. */
public final class OfflineBridge {
    private final Activity activity;
    private final WebView web;
    private final File root;

    OfflineBridge(Activity a, WebView w) {
        activity = a; web = w; root = new File(a.getFilesDir(), "offline");
    }

    private static String safe(String s) { return s == null ? "" : s.replaceAll("[^A-Za-z0-9_-]", "_"); }
    private File dir(String kind) { File d = new File(root, safe(kind)); d.mkdirs(); return d; }

    private File find(String kind, String id) {
        File[] fs = dir(kind).listFiles();
        String prefix = safe(id) + ".";
        if (fs != null) for (File f : fs) if (f.getName().startsWith(prefix) && !f.getName().endsWith(".part")) return f;
        return null;
    }

    @JavascriptInterface public boolean has(String kind, String id) { return find(kind, id) != null; }

    @JavascriptInterface public String path(String kind, String id) {
        File f = find(kind, id);
        return f == null ? "" : "file://" + f.getAbsolutePath();
    }

    @JavascriptInterface public boolean remove(String kind, String id) {
        File f = find(kind, id);
        return f != null && f.delete();
    }

    @JavascriptInterface public void download(final String kind, final String id, final String link) {
        if (link == null || !link.startsWith("https://")) { report(kind, id, 0, "error"); return; }
        new Thread(() -> {
            File part = null;
            try {
                String ext = "pdf".equals(kind) ? "pdf" : extOf(link);
                File out = new File(dir(kind), safe(id) + "." + ext);
                part = new File(out.getPath() + ".part");
                HttpURLConnection h = (HttpURLConnection) new URL(link).openConnection();
                h.setConnectTimeout(20000); h.setReadTimeout(30000);
                if (h.getResponseCode() != 200) throw new Exception("http " + h.getResponseCode());
                long total = h.getContentLengthLong(), got = 0; int last = -1;
                try (InputStream in = h.getInputStream(); FileOutputStream fo = new FileOutputStream(part)) {
                    byte[] buf = new byte[32768]; int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n); got += n;
                        int p = total > 0 ? (int) (got * 100 / total) : 0;
                        if (p != last) { last = p; report(kind, id, p, "progress"); }
                    }
                }
                File old; while ((old = find(kind, id)) != null) old.delete();
                if (!part.renameTo(out)) throw new Exception("rename");
                report(kind, id, 100, "done");
            } catch (Exception e) {
                if (part != null) part.delete();
                report(kind, id, 0, "error");
            }
        }).start();
    }

    private static String extOf(String link) {
        String p = link.split("[?#]")[0].toLowerCase(Locale.US);
        int i = p.lastIndexOf('.');
        String e = i >= 0 ? p.substring(i + 1) : "";
        return e.matches("mp3|m4a|aac|ogg|wav|mp4|webm") ? e : "mp3";
    }

    private void report(String kind, String id, int pct, String state) {
        final String js = "window.onOfflineProgress&&window.onOfflineProgress('" + safe(kind) + "','" + safe(id) + "'," + pct + ",'" + state + "')";
        activity.runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    @JavascriptInterface public int pdfPages(String id) {
        File f = find("pdf", id); if (f == null) return 0;
        try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY); PdfRenderer r = new PdfRenderer(fd)) {
            return r.getPageCount();
        } catch (Exception e) { return 0; }
    }

    /** Renders one page as a JPEG data URL, width in pixels. */
    @JavascriptInterface public String pdfPage(String id, int index, int width) {
        File f = find("pdf", id); if (f == null) return "";
        width = Math.max(300, Math.min(width, 1600));
        try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY); PdfRenderer r = new PdfRenderer(fd)) {
            if (index < 0 || index >= r.getPageCount()) return "";
            PdfRenderer.Page p = r.openPage(index);
            int h = Math.max(1, Math.round(width * (float) p.getHeight() / p.getWidth()));
            Bitmap bm = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888);
            new Canvas(bm).drawColor(Color.WHITE);
            p.render(bm, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            p.close();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.JPEG, 85, bo); bm.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) { return ""; }
    }
}
