param([string]$Grid, [string]$Base, [string]$Out, [string]$Start = "2017-01-01", [int]$Samples = 2500, [int]$Climb = 8, [string]$End = "")
$grid = (Get-Content $Grid -Raw) -replace '\s+',''
$base = (Get-Content $Base -Raw) -replace '\s+',''
$args = @('run','-A','tools/sth_cb_lab/optimize.ts','--series','close','--grid',$grid,'--base',$base,'--start',$Start,'--upfront','1000','--monthly','0','--mode','random','--samples',"$Samples",'--climb',"$Climb",'--walk-forward','--top','25','--workers','8')
if ($End) { $args += @('--end',$End) }
& deno @args *> $Out
