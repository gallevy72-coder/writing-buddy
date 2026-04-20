@echo off
echo.
echo  ====================================
echo   חבר לכתיבה - מפעיל את האפליקציה
echo  ====================================
echo.

cd /d "%~dp0"

REM בדוק אם dist קיים, אם לא - בנה
if not exist "client\dist\index.html" (
    echo בונה את האפליקציה בפעם הראשונה - זה ייקח כדקה...
    cd client
    call npm run build
    cd ..
    echo.
    echo הבנייה הסתיימה!
    echo.
)

echo האפליקציה עולה...
echo פתחי את הדפדפן בכתובת: http://localhost:3001
echo.
echo לסגירה: לחצי Ctrl+C
echo.

cd server
node index.js
