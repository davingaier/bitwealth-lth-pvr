"""Quick validation — prints month-by-month cashflow to console."""
import sys; sys.path.insert(0, ".")

# Inline the simulation (copy key params)
MONTHS = 36; BASE_YEAR = 2026; BASE_MO = 6
PLATFORM_FEE = 0.0075; PERF_FEE = 0.10; MONTHLY_RET = 0.20/12; PERF_PERIOD = 3
AUM_COST_PA = 0.0025; CAEP_ONBOARD = 50_000; SOFTWARE = 5_000; CO_SEC_ANNUAL = 3_000
CAEP_HOSTING_SCHED = {1:20000,2:20000,3:20000,4:30000,5:30000,6:30000}
CAEP_HOSTING_BASE = 40_000
CLIENTS_CONFIG = [
    dict(name="C1", start=1, lump=300_000, monthly=200_000),
    dict(name="C2", start=2, lump=0,       monthly=40_000),
    dict(name="C3", start=2, lump=5_000_000, monthly=0),
]
NEW_CLIENT_MONTHLY=50_000; NEW_CLIENT_START=4; NEW_CLIENT_INTERVAL=3
_MO = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
def mo_label(m):
    total=BASE_MO-1+(m-1); yr=BASE_YEAR+total//12; mo=total%12+1
    return f"{_MO[mo-1]}-{str(yr)[2:]}"
def caep_hosting(m): return CAEP_HOSTING_SCHED.get(m, CAEP_HOSTING_BASE)
class C:
    def __init__(self,name,start,lump,monthly,period=PERF_PERIOD):
        self.name=name;self.start=start;self.lump=lump;self.monthly=monthly
        self.period=period;self.aum=0.;self.hwm=0.;self.since=0
    def step(self,m):
        if m<self.start: return dict(contrib=0.,closing=0.,plat=0.,perf=0.)
        contrib=float(self.lump+self.monthly) if m==self.start else float(self.monthly)
        plat=contrib*PLATFORM_FEE; self.aum+=contrib; self.hwm+=contrib
        ret=self.aum*MONTHLY_RET; self.aum+=ret; self.since+=1
        perf=0.
        if self.since>=self.period:
            if self.aum>self.hwm: perf=(self.aum-self.hwm)*PERF_FEE; self.aum-=perf; self.hwm=self.aum
            self.since=0
        return dict(contrib=contrib,closing=self.aum,plat=plat,perf=perf)

clients=[C(**c) for c in CLIENTS_CONFIG]
for i,s in enumerate(range(NEW_CLIENT_START,MONTHS+1,NEW_CLIENT_INTERVAL)):
    clients.append(C(name=f"NC{i+1}(M{s})",start=s,lump=0,monthly=NEW_CLIENT_MONTHLY))

print(f"{'Mo':>3} {'Label':>7}  {'AUM':>15}  {'Platform':>10}  {'PerfFee':>10}  {'TotRev':>10}  {'TotCost':>10}  {'Net':>10}  {'Cumulative':>12}")
print("-"*110)
cum=0.
for m in range(1,MONTHS+1):
    cd=[c.step(m) for c in clients]
    aum=sum(c.aum for c in clients)
    plat=sum(d['plat'] for d in cd); perf=sum(d['perf'] for d in cd); rev=plat+perf
    c_on=CAEP_ONBOARD if m==1 else 0.
    c_h=float(caep_hosting(m)); c_a=aum*AUM_COST_PA/12; c_s=float(SOFTWARE)
    c_sec=float(CO_SEC_ANNUAL) if m%12==0 else 0.
    cost=c_on+c_h+c_a+c_s+c_sec; net=rev-cost; cum+=net
    tag="<< M net>0" if net>0 else ("<<BREAKEVEN" if cum>=0 else "")
    print(f"{m:>3} {mo_label(m):>7}  {aum:>15,.0f}  {plat:>10,.0f}  {perf:>10,.0f}  {rev:>10,.0f}  {cost:>10,.0f}  {net:>10,.0f}  {cum:>12,.0f}  {tag}")
