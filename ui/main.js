define([
    "p4/io/ajax",
    "p4/io/parser",
    "p4/core/datastruct",
    "p4/core/arrays",
    "p4/core/pipeline",
    "p4/dataopt/stats",
    "i2v/charts/scatter",
    "i2v/charts/column",
    "i2v/charts/stackedArea",
    "i2v/colors",
    "i2v/format",
    "parallelCoordinate",
    "nodeLink",
    "chord"
], function(
    ajax,
    dsv,
    dataStruct,
    arrays,
    pipeline,
    stats,
    scatterPlot,
    column,
    stackedArea,
    Colors,
    format,
    PC,
    nodeLinkGraph,
    chord
) {
    return function main(dataSet, numKP) {
        ajax.getAll([
            { url: dataSet + "/ross-stats-rt-lps.json ", dataType: "json" },
            { url: dataSet + "/ross-stats-gvt-lps.json ", dataType: "json" },
            { url: dataSet + "/ross-stats-gvt-kps.json ", dataType: "json" },
            { url: dataSet + "/ross-stats-gvt-pes.json ", dataType: "json" },
            { url: dataSet + "/routers-kps.txt ", dataType: "text" },
            { url: dataSet + "/lp-mapping.txt ", dataType: "text" },
            { url: dataSet + "/ross-stats-evrb-pes.json ", dataType: "json" },
            { url: dataSet + "/ross-stats-evrb-lp-type.json ", dataType: "json" },
        ]).then(function(input){
            var rtLPData = input[0].map(function(d){
                d.all.RT = d.RT;
                d.all.GVT = d.GVT;
                return d.all;
            })

            var gvtLPData = input[1].map(function(d){
                d.all.GVT = d.GVT;
                return d.all;
            })

            var lpRawData = input[1],
                kpRawData= input[2],
                peRawData = input[3];

            var routerKP = dataStruct({
                array:  dsv(input[4], ","),
                header: 'PE_ID,KP_ID,LP_ID,routers_per_kp'.split(","),
                types:[ 'int', 'int', 'int', 'int' ],
                skip: 1,
            })
            .objectArray()

            var routerKP = pipeline()
            .derive(function(d){
                d.KP_ID = d.PE_ID * numKP + d.KP_ID;
            })
            .sortBy({KP_ID: -1})
            (routerKP);

            var lpTypes = dataStruct({
                array:  dsv(input[5], ","),
                header: ['PE_ID','KP_ID','LP_ID', 'LP_type'],
                types: [ 'int', 'int', 'int', 'string' ],
                skip: 1,
            }).objectArray();

            function brushRT(box) {
                var rtData = rtLPData.filter(function(d){
                    return d.RT >= box.x[0] && d.RT <= box.x[1];
                });
                if(rtData.length){
                    var rtDomains = stats.domains(rtData.filter(function(d){ return d.GVT !== null;}), ["GVT"]);

                    var gvtData = gvtLPData.filter(function(d){
                        return d.GVT > rtDomains.GVT[0] && d.GVT <= rtDomains.GVT[1];
                    });

                    if(gvtData.length) {
                        gvtChart.update(gvtData);
                    }
                }
            }

            function brushGVT(box) {
                showDetailView(box.x);
            }

            var sac = new stackedArea({
                data: rtLPData ,
                width: 980,
                height: 150,
                container: "timelineView",
                vmap: { x: "RT", y: ['events_processed','events_rolled_back']},
                label: {x: "Real Time (s)", y: "# Events"},
                brush: { x: true, y: false, brushend: brushRT},
                padding: {left: 60, bottom: 40, top: 20, right: 30},
                // formatX: function(n) { return format('.3s') + "s"; }
            });
            //

            var gvtChart = new stackedArea({
                data: gvtLPData,
                width: 980,
                height: 260,
                container: "timelineView",
                label: {x: "Simulated Time (ms)", y: "# Events"},
                vmap: { x: "GVT", y: ['events_processed','events_rolled_back']},
                brush: { x: true, y: false, brushend: brushGVT },
                padding: {left: 60, bottom: 40, top: 30, right: 30},
                formatX: function(n) { return format('.3s')(n/1000); }
            });

            function showDetailView(gvtRange) {
                $("#mainView").html("");
                $("#detailView").html("");
                function filterByGVT(rawData, vmap) {
                    var colResult = {};
                    var data = rawData.filter(function(d){
                        return d.GVT >= gvtRange[0] && d.GVT <= gvtRange[1];
                    });

                    Object.keys(vmap).forEach(function(k, ki){
                        if(vmap[k] == "efficiency") {
                            colResult[vmap[k]] = arrays.vectorAvg(data.map(function(d) { return d[vmap[k]]; }));
                        } else {
                            colResult[vmap[k]] = arrays.vectorSum(data.map(function(d) { return d[vmap[k]]; }));
                        }
                    })
                    return colResult[vmap.x].map(function(d, i){
                        var res = {};
                        res[vmap.x] = colResult[vmap.x][i];
                        res[vmap.y] = colResult[vmap.y][i];
                        return res;
                    })
                }

                var vmapPE = {x: "net_events", y: "efficiency"};

                var vmapKP = {x: "total_rollbacks", y: "secondary_rollbacks"};
                var resultKP = filterByGVT(kpRawData, vmapKP);
                resultKP.forEach(function(d, i){
                    d.routers_per_kp = routerKP[i].routers_per_kp;
                });
                vmapKP.color = "routers_per_kp";


                var vmapLP = {x: "events_rolled_back", y: "remote_events"};
                var resultLP = filterByGVT(lpRawData, vmapLP);
                resultLP.forEach(function(d, i){
                    d.LP_type = lpTypes[i].LP_type;
                });
                vmapLP.color = "LP_type";

                var peData = filterByGVT(peRawData, vmapPE);
                var groupKP = pipeline().derive(function(d, i){
                    d.PE = Math.floor(i/numKP);
                })
                .group({
                    $by: "PE",
                    total_rollbacks: "$sum",
                    secondary_rollbacks: "$sum"
                })
                .sortBy({PE: -1})

                var groupLP = pipeline().derive(function(d, i){
                    d.PE = lpTypes[i].PE_ID;
                })
                .group({
                    $by: "PE",
                    remote_events: "$sum",
                    events_rolled_back: "$sum"
                })
                .sortBy({PE: -1})

                var kpData = groupKP(resultKP),
                    lpData = groupLP(resultLP);

                peData.forEach(function(d,i){
                    d.total_rollbacks = kpData[i].total_rollbacks;
                    d.remote_events = lpData[i].remote_events;
                    d.events_rolled_back = lpData[i].events_rolled_back;
                    d.PE_ID = i;
                })

                var pcData = new PC({
                    width: 1020,
                    height: 320,
                    data: peData,
                    onupdate: updateDetail,
                    container: "#mainView"
                })

                var plotKP = new scatterPlot({
                    width: 330,
                    height: 320,
                    data:  resultKP,
                    vmap: vmapKP,
                    container: "detailView",
                    colors: ["#E00", "#00E"],
                    colorDomain: ["KP with router", "KP without router"],
                    title: "KP-Level Statistics",
                    padding: {left: 70, bottom: 40, top: 40, right: 20}
                })
                var plotLP = new scatterPlot({
                    width: 330,
                    height: 320,
                    vmap: vmapLP,
                    colors: ["green",  "#AA0", "purple"],
                    colorDomain: ["server", "terminal", "router"],
                    data:  resultLP,
                    container: "detailView",
                    title: "LP-Level Statistics",
                    padding: {left: 70, bottom: 40, top:40, right: 20}
                })

                var peComData = input[6].filter(function(d){
                    return d.GVT >= gvtRange[0] && d.GVT <= gvtRange[1];
                });

                var lpComData = input[7].filter(function(d){
                    return d.GVT >= gvtRange[0] && d.GVT <= gvtRange[1];
                });

                var numPE = peComData[0].PE.length,
                    peComMatrix = [],
                    lpComMatrix = [],
                    peGraphData = {nodes: [], links: []},
                    lpGraphData = {nodes: [], links: []};

                for(var i = 0; i < numPE; i++) {
                    lpComMatrix[i] = {};

                    ['server', 'terminal', 'router'].forEach(function(srcLPType, ti){
                        lpComMatrix[i][srcLPType] = {};
                        lpGraphData.nodes.push({PE: i, LP_type: srcLPType});

                        ['server', 'terminal', 'router', ].forEach(function(destLPType, tj){
                            lpComMatrix[i][srcLPType][destLPType] = arrays.vectorSum(lpComData.map(function(d){
                                return d.PE[i][srcLPType][destLPType];
                            }));

                            lpComMatrix[i][srcLPType][destLPType].forEach(function(lv, j){
                                lpGraphData.links.push({source: i*3+ti, target: j*3 + tj, value: lv});
                            })
                        });
                    })
                }
                //
                // nodeLinkGraph({
                //     data:lpGraphData,
                //     container: "#detailView"
                // });


                for(var i = 0; i < numPE; i++) {
                    peComMatrix[i] = arrays.vectorSum(peComData.map(function(d){
                            return d.PE[i];
                    }));

                    peGraphData.nodes.push(peData[i]);

                    // peGraphData.links.push(peComMatrix[i].map(function(d, j){
                    //     return {source: i, target: j, value: d}
                    // }));
                }
                chord({
                    container: "#detailView",
                    width: 350,
                    height: 350,
                    data: {matrix: peComMatrix, nodes: peGraphData.nodes}
                })


                function updateDetail(data) {
                    $("#detailView").html("");
                    $("#chordChart").remove();
                    var PEs = data.map(function(d) {return d.PE_ID})
                    // console.log(PEs);

                    var newKpData = pipeline().match({
                        PE: {$in: PEs}
                    })(resultKP);

                    var newLpData = pipeline().match({
                        PE: {$in: PEs}
                    })(resultLP);

                    // console.log(newLpData);
                    var plotKP = new scatterPlot({
                        width: 330,
                        height: 320,
                        data:  newKpData,
                        vmap: vmapKP,
                        container: "detailView",
                        colors: ["#E00", "#00E"],
                        colorDomain: ["KP with router", "KP without router"],
                        title: "KP-Level Statistics",
                        padding: {left: 50, bottom: 40, top: 40, right: 20}
                    })
                    var plotLP = new scatterPlot({
                        width: 330,
                        height: 320,
                        vmap: vmapLP,
                        colors: ["green",  "#AA0", "purple"],
                        colorDomain: ["server", "terminal", "router"],
                        data:  newLpData,
                        container: "detailView",
                        title: "LP-Level Statistics",
                        padding: {left: 50, bottom: 40, top:40, right: 20}
                    })

                    var newPeComMatrix = [],
                        newLpComMatrix = [];

                    PEs.forEach(function(pi){
                        var dest = [];
                        PEs.forEach(function(pj){
                            dest.push(peComMatrix[pi][pj])
                        });

                        newPeComMatrix.push(dest);
                    })

                    PEs.forEach(function(pi, i){
                        newLpComMatrix[i] = {};
                        ['server', 'terminal', 'router'].forEach(function(srcLPType, ti){
                            newLpComMatrix[i][srcLPType] = {};
                            ['server', 'terminal', 'router'].forEach(function(destLPType, tj){
                                var dest = [];

                                PEs.forEach(function(pj){
                                    dest.push(lpComMatrix[pi][srcLPType][destLPType][pj])
                                });
                                newLpComMatrix[i][srcLPType][destLPType] = dest;
                            });
                        })
                    })

                    var newPeComNodes = pipeline().match({
                        PE_ID: {$in: PEs}
                    })(peGraphData.nodes);


                    chord({
                        container: "#detailView",
                        width: 350,
                        height: 350,
                        data: {matrix: newPeComMatrix, nodes: newPeComNodes}
                    })

                    // var newLpGraphData = {nodes: [], links: []};
                    //
                    // newLpGraphData.nodes = pipeline().match({
                    //     PE: {$in: PEs}
                    // })(lpGraphData.nodes);
                    // // console.log(newLpGraphData.nodes, newLpComMatrix);
                    // PEs.forEach(function(pi, i){
                    //
                    //     ['server', 'terminal', 'router'].forEach(function(srcLPType, ti){
                    //         ['server', 'terminal', 'router', ].forEach(function(destLPType, tj){
                    //
                    //             newLpComMatrix[i][srcLPType][destLPType].forEach(function(lv, j){
                    //                 newLpGraphData.links.push({source: i*3+ti, target: j*3 + tj, value: lv});
                    //             })
                    //         });
                    //     })
                    // });
                    //
                    // nodeLinkGraph({
                    //     data:newLpGraphData,
                    //     container: "#detailView"
                    // });
                }
            }

        })
    }
});
