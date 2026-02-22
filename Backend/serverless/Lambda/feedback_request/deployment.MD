rm -rf build deploy.zip
mkdir build
cp feedback_request.py build/
cd build
zip -qr ../deploy.zip .
cd ..

note: only uses boto3 (included in Lambda runtime), no extra dependencies needed
