@echo off
title AnatoPose 3D Local Server
echo ========================================================
echo  AnatoPose 3D - 藝用脊椎與肋骨姿態還原系統
echo ========================================================
echo.
echo 伺服器正在啟動中...
echo 請在瀏覽器中開啟以下網址：
echo.
echo    http://localhost:8080
echo.
echo ========================================================
echo 正在開啟瀏覽器...
start http://localhost:8080
"C:\msys64\ucrt64\bin\python.exe" -m http.server 8080 --directory "%~dp0"
pause

