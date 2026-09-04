FROM python:3.11-slim 

WORKDIR /app

COPY . .

RUN pip install -r requirements.txt

RUN apt-get update && \
    apt-get install -y libgomp1 && \
    rm -rf /var/lib/apt/lists/*


CMD ["python", "flask_api/main.py"]
