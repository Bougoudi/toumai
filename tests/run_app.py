# L'application réelle, avec un faux Trendyol (réponses conformes à la documentation)
import os, sys, base64, httpx, uvicorn
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import trendyol, main
N={"n":0}
def handler(req):
    if req.headers["Authorization"]!="Basic "+base64.b64encode(b"KEYABCD:SECRETXYZ").decode():
        return httpx.Response(401,json={})
    p=dict(req.url.params)
    if int(p.get("page",0))>0: return httpx.Response(200,json={"content":[],"totalPages":1})
    if "/orders" in req.url.path:
        N["n"]+=1
        if N["n"]%3!=1: return httpx.Response(200,json={"content":[],"totalPages":1})   # une seule fenêtre avec données
        return httpx.Response(200,json={"totalPages":1,"content":[
          {"orderNumber":"A1","status":"Delivered","lines":[
             {"productName":"Tişört","barcode":"B1","quantity":2,"price":300,"amount":600,"discount":0},
             {"productName":"Tayt","barcode":"B2","quantity":1,"lineGrossAmount":400,"lineSellerDiscount":0}]},
          {"orderNumber":"A2","status":"Returned","lines":[{"productName":"Tayt","barcode":"B2","quantity":1,"price":400,"amount":400,"discount":0}]},
          {"orderNumber":"A3","status":"Cancelled","lines":[{"productName":"Tişört","barcode":"B1","quantity":1,"price":300,"amount":300,"discount":0}]}]})
    return httpx.Response(200,json={"totalPages":1,"content":[{"id":"T1","orderNumber":"A1","barcode":"B1","commissionAmount":-108},{"id":"T2","orderNumber":"A1","barcode":"B2","commissionAmount":-72}]})
orig=trendyol._client
def fake(sid,k,s):
    c=orig(sid,k,s); h=dict(c.headers); c.close()
    return httpx.Client(transport=httpx.MockTransport(handler),headers=h)
trendyol._client=fake
uvicorn.run(main.app, port=8765, log_level="warning")
