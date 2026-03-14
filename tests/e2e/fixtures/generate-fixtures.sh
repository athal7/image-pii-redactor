#!/usr/bin/env bash
# Generates e2e test fixture images using ImageMagick 7 (magick).
#
# Each fixture targets a distinct real-world upload scenario:
#
#   light-mode-chat.png       — white-background chat (ChatGPT/Claude light theme)
#   no-pii.png                — screenshot with zero PII (should produce 0 redactions)
#   regex-only.png            — PII detectable purely by regex (SSN, credit card, IP)
#   small-mobile.png          — low-res mobile screenshot (390×844 equivalent crop)
#   hidpi.png                 — 2× high-DPI screenshot (1600×1200)
#   jpeg-artifact.jpg         — JPEG with compression noise
#   webp-format.webp          — WebP format upload
#   multiline-email.png       — email address split across a line break by OCR noise
#   slack-style.png           — two-column chat layout (sidebar + message area)
#
# Usage: bash tests/e2e/fixtures/generate-fixtures.sh
# Output: tests/e2e/fixtures/*.{png,jpg,webp}

set -euo pipefail
OUTDIR="$(dirname "$0")"
cd "$(git rev-parse --show-toplevel)"

# ── Shared helpers ─────────────────────────────────────────────────────────────

# Common font / point sizes
FONT_BODY=16
FONT_SM=13
FONT_LG=20

# ── 1. light-mode-chat.png ─────────────────────────────────────────────────────
# Simulates a Claude.ai / ChatGPT light-theme screenshot.
# PII present: name, email, phone, date.
magick -size 800x520 xc:'#ffffff' \
  \
  -fill '#f0f0f0' -draw "rectangle 0,0 800,44" \
  -fill '#333333' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "Chat with Claude" \
  \
  -fill '#e8f4fd' -draw "rectangle 30,60 580,145" \
  -fill '#1a1a1a' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+85  "Hi Claude! I'm Alex Rivera." \
    -annotate +45+105 "Contact me at alex.rivera@example.com" \
    -annotate +45+128 "or call (415) 555-0192." \
  \
  -fill '#f9f9f9' -draw "rectangle 220,165 770,250" \
  -fill '#333333' -pointsize $FONT_BODY -font Helvetica \
    -annotate +235+190 "Hello Alex! I'm here to help." \
    -annotate +235+213 "Is your birthday still March 14, 1990?" \
    -annotate +235+236 "I see your account was created on 2021-06-01." \
  \
  -fill '#e8f4fd' -draw "rectangle 30,270 580,340" \
  -fill '#1a1a1a' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+295 "Yes, March 14 is correct." \
    -annotate +45+318 "My user ID is @alex_r and zip is 94107." \
  \
  -fill '#f9f9f9' -draw "rectangle 220,360 770,430" \
  -fill '#333333' -pointsize $FONT_BODY -font Helvetica \
    -annotate +235+385 "Got it, Alex. I've noted your details." \
    -annotate +235+408 "Is there anything else I can help with?" \
  \
  "$OUTDIR/light-mode-chat.png"

echo "  [OK] light-mode-chat.png"

# ── 2. no-pii.png ──────────────────────────────────────────────────────────────
# A screenshot that contains NO personal information.
# Tests that the pipeline correctly reports 0 redactions.
magick -size 800x400 xc:'#1e2130' \
  \
  -fill '#2d3250' -draw "rectangle 0,0 800,44" \
  -fill '#e0e0e0' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "AI Assistant Chat" \
  \
  -fill '#3b82f6' -draw "rectangle 30,60 500,120" \
  -fill '#ffffff' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+82  "What is the capital of France?" \
    -annotate +45+106 "I would like to learn more about history." \
  \
  -fill '#2d3250' -draw "rectangle 300,140 770,220" \
  -fill '#e0e0e0' -pointsize $FONT_BODY -font Helvetica \
    -annotate +315+162 "The capital of France is Paris." \
    -annotate +315+186 "Paris has been the capital since the 10th century." \
    -annotate +315+210 "It sits on the Seine river in northern France." \
  \
  -fill '#3b82f6' -draw "rectangle 30,240 500,300" \
  -fill '#ffffff' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+262 "Interesting! What about Germany?" \
    -annotate +45+286 "Tell me about Berlin." \
  \
  -fill '#2d3250' -draw "rectangle 300,320 770,380" \
  -fill '#e0e0e0' -pointsize $FONT_BODY -font Helvetica \
    -annotate +315+342 "Berlin is the capital of Germany." \
    -annotate +315+366 "It became the capital in 1990 after reunification." \
  \
  "$OUTDIR/no-pii.png"

echo "  [OK] no-pii.png"

# ── 3. regex-only.png ──────────────────────────────────────────────────────────
# PII detectable by structured regex patterns only (SSN, credit card, IP, URL).
# Tests the regex pipeline branch independently of NER model output.
magick -size 800x500 xc:'#ffffff' \
  \
  -fill '#f5f5f5' -draw "rectangle 0,0 800,44" \
  -fill '#333333' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "Support Ticket #4821" \
  \
  -fill '#fff3cd' -draw "rectangle 30,60 770,160" \
  -fill '#333333' -pointsize $FONT_SM -font Helvetica-Bold \
    -annotate +45+82  "Customer Details (CONFIDENTIAL)" \
  -font Helvetica \
    -annotate +45+104 "SSN:            123-45-6789" \
    -annotate +45+126 "Credit Card:    4532 1234 5678 9012  (expires 09/27)" \
    -annotate +45+148 "Loyalty ID:     ID-8827364" \
  \
  -fill '#f0fff0' -draw "rectangle 30,175 770,275" \
  -fill '#333333' -pointsize $FONT_SM -font Helvetica-Bold \
    -annotate +45+197 "Technical Details" \
  -font Helvetica \
    -annotate +45+219 "IP Address:     192.168.1.105" \
    -annotate +45+241 "Login URL:      https://internal.corp.example.com/login?token=abc123" \
    -annotate +45+263 "Last login:     2024-11-15" \
  \
  -fill '#fff0f0' -draw "rectangle 30,295 770,395" \
  -fill '#333333' -pointsize $FONT_SM -font Helvetica-Bold \
    -annotate +45+317 "Contact" \
  -font Helvetica \
    -annotate +45+339 "Email:          support.user@company.org" \
    -annotate +45+361 "Phone:          +1-800-555-0134 ext. 42" \
    -annotate +45+383 "Alt Phone:      (650) 555.8765" \
  \
  "$OUTDIR/regex-only.png"

echo "  [OK] regex-only.png"

# ── 4. small-mobile.png ────────────────────────────────────────────────────────
# Small mobile screenshot (390×280, simulates a phone crop).
# Tests OCR + pipeline on low-resolution input.
magick -size 390x280 xc:'#1a1a2e' \
  \
  -fill '#16213e' -draw "rectangle 0,0 390,32" \
  -fill '#e0e0e0' -pointsize 12 -font Helvetica \
    -annotate +10+22 "Chat" \
  \
  -fill '#0f3460' -draw "rectangle 10,40 300,100" \
  -fill '#ffffff' -pointsize 11 -font Helvetica \
    -annotate +20+58  "Hi, I'm Jordan Kim." \
    -annotate +20+74  "Reach me: jordan@example.com" \
    -annotate +20+90  "Ph: 212-555-0177" \
  \
  -fill '#16213e' -draw "rectangle 90,115 380,170" \
  -fill '#cccccc' -pointsize 11 -font Helvetica \
    -annotate +100+133 "Hello Jordan! I can help." \
    -annotate +100+149 "DOB on file: 1988-04-22." \
    -annotate +100+165 "Is that correct?" \
  \
  -fill '#0f3460' -draw "rectangle 10,180 300,230" \
  -fill '#ffffff' -pointsize 11 -font Helvetica \
    -annotate +20+198 "Yes, April 22 is right." \
    -annotate +20+214 "My zip is 10001." \
  \
  "$OUTDIR/small-mobile.png"

echo "  [OK] small-mobile.png"

# ── 5. hidpi.png ───────────────────────────────────────────────────────────────
# 2× high-DPI retina screenshot (1600×1000).
# Tests that the pipeline handles large images without crashing.
magick -size 1600x1000 xc:'#0d1117' \
  \
  -fill '#161b22' -draw "rectangle 0,0 1600,68" \
  -fill '#e6edf3' -pointsize 28 -font Helvetica \
    -annotate +30+50 "AI Chat — High-DPI Screenshot" \
  \
  -fill '#1f6feb' -draw "rectangle 50,100 900,230" \
  -fill '#ffffff' -pointsize 24 -font Helvetica \
    -annotate +70+140 "My name is Morgan Lee and I live at" \
    -annotate +70+174 "500 Main Street, Austin, TX 78701." \
    -annotate +70+208 "Email: morgan.lee@work.io" \
  \
  -fill '#161b22' -draw "rectangle 700,260 1550,400" \
  -fill '#c9d1d9' -pointsize 24 -font Helvetica \
    -annotate +720+300 "Hi Morgan! I can see your address." \
    -annotate +720+334 "Phone on file: +1 (512) 555-0203." \
    -annotate +720+368 "SSN ends in 6789 — please verify." \
  \
  -fill '#1f6feb' -draw "rectangle 50,430 900,520" \
  -fill '#ffffff' -pointsize 24 -font Helvetica \
    -annotate +70+468  "That's right. My full SSN: 987-65-4321." \
    -annotate +70+502  "DOB: January 5, 1985." \
  \
  "$OUTDIR/hidpi.png"

echo "  [OK] hidpi.png"

# ── 6. jpeg-artifact.jpg ───────────────────────────────────────────────────────
# JPEG screenshot with compression artifacts (quality 60).
# Tests pipeline resilience to lossy image compression.
magick -size 800x480 xc:'#ffffff' \
  \
  -fill '#eeeeee' -draw "rectangle 0,0 800,44" \
  -fill '#222222' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "Customer Support Chat" \
  \
  -fill '#dceeff' -draw "rectangle 30,60 640,160" \
  -fill '#1a1a1a' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+84  "Hello, I need help with my account." \
    -annotate +45+108 "Name: Patricia Walsh" \
    -annotate +45+132 "Email: pat.walsh@domain.net" \
    -annotate +45+156 "DOB: 07/04/1979" \
  \
  -fill '#f5f5f5' -draw "rectangle 160,180 770,280" \
  -fill '#333333' -pointsize $FONT_BODY -font Helvetica \
    -annotate +175+204 "Hi Patricia! Account verified." \
    -annotate +175+228 "Mailing address: 88 Oak Lane, Boston MA 02101." \
    -annotate +175+252 "Phone on record: 617-555-0129." \
    -annotate +175+276 "What can I help you with today?" \
  \
  -fill '#dceeff' -draw "rectangle 30,300 640,370" \
  -fill '#1a1a1a' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+324 "Please update my credit card:" \
    -annotate +45+348 "4111 1111 1111 1111, exp 12/28, CVV 456." \
  \
  -quality 60 \
  "$OUTDIR/jpeg-artifact.jpg"

echo "  [OK] jpeg-artifact.jpg"

# ── 7. webp-format.webp ────────────────────────────────────────────────────────
# Same content as light-mode-chat but saved as WebP.
# Tests that the component accepts image/webp MIME type correctly.
magick -size 800x420 xc:'#fafafa' \
  \
  -fill '#e5e5ea' -draw "rectangle 0,0 800,44" \
  -fill '#333333' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "iMessage Conversation" \
  \
  -fill '#007aff' -draw "roundrectangle 200,60 770,140 12,12" \
  -fill '#ffffff' -pointsize $FONT_BODY -font Helvetica \
    -annotate +215+84  "Hey! I'm Taylor Brown." \
    -annotate +215+108 "My new number: (303) 555-0187." \
    -annotate +215+130 "Email: t.brown@icloud.com" \
  \
  -fill '#e5e5ea' -draw "roundrectangle 30,160 600,240 12,12" \
  -fill '#333333' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+184  "Got it Taylor! Saved." \
    -annotate +45+208  "Your DOB shows as September 9, 1995." \
    -annotate +45+230  "Is that still correct?" \
  \
  -fill '#007aff' -draw "roundrectangle 200,260 770,330 12,12" \
  -fill '#ffffff' -pointsize $FONT_BODY -font Helvetica \
    -annotate +215+284 "Yes that's right." \
    -annotate +215+308 "Old address was 22 Pine St, Denver CO 80203." \
  \
  -quality 80 \
  "$OUTDIR/webp-format.webp"

echo "  [OK] webp-format.webp"

# ── 8. multiline-email.png ─────────────────────────────────────────────────────
# Email address deliberately placed near a line wrap point.
# Tests that the bridge correctly groups words on the same OCR line.
magick -size 800x380 xc:'#1e2130' \
  \
  -fill '#2d3250' -draw "rectangle 0,0 800,44" \
  -fill '#e0e0e0' -pointsize $FONT_LG -font Helvetica \
    -annotate +20+30 "AI Assistant Chat" \
  \
  -fill '#3b82f6' -draw "rectangle 30,60 650,180" \
  -fill '#ffffff' -pointsize $FONT_BODY -font Helvetica \
    -annotate +45+85  "Please send the invoice to" \
    -annotate +45+109 "billing.dept+q1@verylongcompanyname.co.uk" \
    -annotate +45+133 "and CC it to accounts@finance.example.com" \
    -annotate +45+157 "by January 31, 2025." \
  \
  -fill '#2d3250' -draw "rectangle 150,200 770,300" \
  -fill '#e0e0e0' -pointsize $FONT_BODY -font Helvetica \
    -annotate +165+225 "Understood. I'll send the invoice to both" \
    -annotate +165+249 "billing.dept+q1@verylongcompanyname.co.uk" \
    -annotate +165+273 "and accounts@finance.example.com by the 31st." \
  \
  "$OUTDIR/multiline-email.png"

echo "  [OK] multiline-email.png"

# ── 9. slack-style.png ─────────────────────────────────────────────────────────
# Two-column layout: narrow sidebar on the left + message area on the right.
# Tests the COLUMN_GAP_THRESHOLD_PX logic in bridge.ts.
magick -size 960x560 xc:'#1a1d21' \
  \
  -fill '#19171d' -draw "rectangle 0,0 220,560" \
  -fill '#ffffff' -pointsize 13 -font Helvetica-Bold \
    -annotate +15+30  "Workspace" \
  -fill '#c0bfc4' -pointsize 12 -font Helvetica \
    -annotate +15+60  "# general" \
    -annotate +15+80  "# engineering" \
    -annotate +15+100 "# design" \
    -annotate +15+130 "DMs" \
    -annotate +15+150 "  Casey Park" \
    -annotate +15+170 "  Drew Hoffman" \
  \
  -fill '#1d2026' -draw "rectangle 220,0 960,44" \
  -fill '#e8e8e8' -pointsize 15 -font Helvetica-Bold \
    -annotate +235+28 "# general" \
  \
  -fill '#1d2026' -draw "rectangle 220,60 960,170" \
  -fill '#c0bfc4' -pointsize 12 -font Helvetica-Bold \
    -annotate +235+80  "Casey Park  09:14 AM" \
  -font Helvetica \
    -annotate +235+100 "Hey team, my new contact: casey.park@company.com" \
    -annotate +235+120 "Phone: (206) 555-0148. Address: 12 Birch Ave, Seattle WA 98101." \
    -annotate +235+140 "cc @drew please" \
  \
  -fill '#1d2026' -draw "rectangle 220,180 960,290" \
  -fill '#c0bfc4' -pointsize 12 -font Helvetica-Bold \
    -annotate +235+200 "Drew Hoffman  09:22 AM" \
  -font Helvetica \
    -annotate +235+220 "Got it Casey! I'll update the directory." \
    -annotate +235+240 "SSN for HR form: 234-56-7890 — send via secure channel." \
    -annotate +235+260 "DOB: May 5, 1990 on file — confirming." \
  \
  -fill '#1d2026' -draw "rectangle 220,310 960,400" \
  -fill '#c0bfc4' -pointsize 12 -font Helvetica-Bold \
    -annotate +235+330 "Casey Park  09:35 AM" \
  -font Helvetica \
    -annotate +235+350 "Thanks Drew. IP for VPN: 10.0.0.42." \
    -annotate +235+370 "Credit card ending 4242 expires 03/26." \
  \
  "$OUTDIR/slack-style.png"

echo "  [OK] slack-style.png"

echo ""
echo "All fixtures generated in $OUTDIR/"
