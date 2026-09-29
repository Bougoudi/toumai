# Faux serveur Anthropic : renvoie des réponses au format de l'API Messages (sortie JSON structurée)
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
CALLS=[]
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CALLS.append(body)
        system=body.get("system","")
        q=body["messages"][-1]["content"]
        if "destek asistanı" in system:
            human = ("öde" in q) or ("hata" in q)
            out={"answer":"Ödeme için ekibimiz WhatsApp'tan dönecek." if human else "Maliyet sütununu 'Sütun eşleştirme' kartından seçebilirsin.","needs_human":human}
        else:
            out={"summary":"Tişört iyi, Tayt zarar ediyor.","recommendations":[
              {"product":"Tayt","action":"fiyat_artir","title":"Tayt fiyatını %12 artır","detail":"Kargo ve iade marjı eritiyor.","monthly_impact_try":420},
              {"product":"Tişört","action":"one_cikar","title":"Tişörtü öne çıkar","detail":"Marjı %30.","monthly_impact_try":300},
              {"product":"Tayt","action":"reklami_azalt","title":"Reklamı azalt","detail":"Reklam kârı yiyor.","monthly_impact_try":150}]}
        # vérifie que la requête respecte le format attendu
        assert body["output_config"]["format"]["type"]=="json_schema", body
        resp={"id":"msg_test","type":"message","role":"assistant","model":body["model"],
              "content":[{"type":"text","text":json.dumps(out,ensure_ascii=False)}],
              "stop_reason":"end_turn","stop_sequence":None,"usage":{"input_tokens":10,"output_tokens":10}}
        data=json.dumps(resp).encode()
        self.send_response(200); self.send_header("content-type","application/json"); self.send_header("content-length",str(len(data))); self.end_headers(); self.wfile.write(data)
HTTPServer(("127.0.0.1",8799),H).serve_forever()
