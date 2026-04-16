import socket
import threading
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# Configuration
PHONE_IP = '192.0.0.8'  
PORT = 8080             
HTTP_PORT = 8888

# Shared state
gps_data = {
    "lat": None,
    "lon": None,
    "status": "Connecting...",
    "last_update": 0
}

def parse_nmea_to_decimal(nmea_val, direction):
    """Convert NMEA format (DDMM.MMMM) to Decimal Degrees."""
    try:
        if not nmea_val: return None
        # Lat is DDMM.MMMM (2 chars for deg), Lon is DDDMM.MMMM (3 chars for deg)
        # We can use the decimal point as a reference
        dot_idx = nmea_val.find('.')
        if dot_idx < 0: return None
        
        deg_len = dot_idx - 2
        degrees = float(nmea_val[:deg_len])
        minutes = float(nmea_val[deg_len:])
        
        decimal = degrees + (minutes / 60)
        if direction in ['S', 'W']:
            decimal = -decimal
        return decimal
    except Exception:
        return None

def gps_client_thread():
    global gps_data
    while True:
        try:
            print(f"Connecting to GPS Server at {PHONE_IP}:{PORT}...")
            client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            client.settimeout(10)
            client.connect((PHONE_IP, PORT))
            print("Connected SUCCESS!")
            gps_data["status"] = "Connected"

            while True:
                data = client.recv(1024).decode('utf-8', errors='ignore')
                if not data:
                    break
                
                for line in data.split('\n'):
                    if "$GPRMC" in line:
                        parts = line.split(',')
                        # $GPRMC,Time,Status,Lat,N/S,Lon,E/W,Speed,Course,Date...
                        if len(parts) > 6:
                            status = parts[2] # 'A' = active, 'V' = void
                            if status == 'A':
                                lat = parse_nmea_to_decimal(parts[3], parts[4])
                                lon = parse_nmea_to_decimal(parts[5], parts[6])
                                
                                if lat is not None and lon is not None:
                                    gps_data["lat"] = lat
                                    gps_data["lon"] = lon
                                    gps_data["last_update"] = time.time()
                                    gps_data["status"] = "Active"
                            else:
                                gps_data["status"] = "No Signal"
            
            client.close()
        except Exception as e:
            print(f"Connection error: {e}")
            gps_data["status"] = f"Error: {e}"
            time.sleep(5) # Retry after delay

class GPSHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/gps':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*') # Allow CORS
            self.end_headers()
            self.wfile.write(json.dumps(gps_data).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return # Silent logging

def run_http_server():
    server_address = ('', HTTP_PORT)
    httpd = HTTPServer(server_address, GPSHandler)
    print(f"Bridge HTTP Server running on http://localhost:{HTTP_PORT}/gps")
    httpd.serve_forever()

if __name__ == "__main__":
    # Start GPS client in background
    client_thread = threading.Thread(target=gps_client_thread, daemon=True)
    client_thread.start()

    # Start HTTP server in main thread
    try:
        run_http_server()
    except KeyboardInterrupt:
        print("\nStopping bridge...")
