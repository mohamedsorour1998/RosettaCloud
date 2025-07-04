rm -rf build deploy.zip
mkdir build
cp feedback_request.py build/ 
pip install --platform manylinux2014_x86_64 \
            --implementation cp --python-version 312 \
            --only-binary=:all: \
            --target build \
            grpcio momento boto3
cd build
zip -qr ../deploy.zip .
cd ..

note: it needs python 3.12 to build the package