// 📦 2021년~2024년 TOP 5 데이터 주머니
const SAFETY_RANK_DATA = {
    "2024": [
        { rank: 1, name: "성북구", score: 74.38 },
        { rank: 2, name: "강북구", score: 73.73 },
        { rank: 3, name: "강서구", score: 69.65 },
        { rank: 4, name: "도봉구", score: 59.5 },
        { rank: 5, name: "금천구", score: 57.72 }
    ],
    "2023": [
        { rank: 1, name: "성북구", score: 88.01 },
        { rank: 2, name: "강북구", score: 79.95 },
        { rank: 3, name: "강서구", score: 77.44 },
        { rank: 4, name: "강동구", score: 60.52 },
        { rank: 5, name: "은평구", score: 59.65 }
    ],
    "2022": [
        { rank: 1, name: "성북구", score: 83.26 },
        { rank: 2, name: "성동구", score: 73.94 },
        { rank: 3, name: "은평구", score: 63.15 },
        { rank: 4, name: "강북구", score: 62.52 },
        { rank: 5, name: "강서구", score: 60.44 }
    ],
    "2021": [
        { rank: 1, name: "강북구", score: 78.75 },
        { rank: 2, name: "성북구", score: 73.11 },
        { rank: 3, name: "강서구", score: 70.1 },
        { rank: 4, name: "성동구", score: 61.8 },
        { rank: 5, name: "은평구", score: 56.99 }
    ]
};

// 🏆 선택된 연도의 데이터를 막대그래프로 그려주는 함수
function showTop5Chart(selectedYear) {
    const currentRankList = SAFETY_RANK_DATA[selectedYear];
    if (!currentRankList) return; // 데이터가 없는 연도면 패스

    // 1. 타이틀과 호버 툴팁(점수 계산식) 구조
    let chartHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin: 15px 0 10px 0;">
            <h3 style="margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 700;">
                🛡️ ${selectedYear}년 안전 TOP 5
            </h3>
            
            <div class="suin-tooltip" style="position: relative; cursor: pointer; font-size: 11px; color: var(--text-secondary); text-decoration: underline;">
                점수 계산식 ℹ️
                <div class="suin-tooltip-text" style="
                    visibility: hidden;
                    width: 210px;
                    background-color: #2c3e50;
                    color: #fff;
                    text-align: left;
                    border-radius: 6px;
                    padding: 10px;
                    position: absolute;
                    z-index: 999;
                    bottom: 125%;
                    right: 0;
                    opacity: 0;
                    transition: opacity 0.3s;
                    font-size: 11px;
                    line-height: 1.4;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                ">
                    <strong>[종합 안전 점수 계산식]</strong><br>
                    Safety Score = (0.7 × Normalized Crime Score + 0.3 × Normalized Arrest Score) × 100
                </div>
            </div>
        </div>
    `;

    // 2. 막대그래프 빌드업
    chartHTML += `<div style="display: flex; flex-direction: column; gap: 12px; background: var(--bg-tertiary); padding: 15px; border-radius: 8px; border: 1.5px solid var(--border);">`;

    currentRankList.forEach((item) => {
        chartHTML += `
            <div style="display: flex; align-items: center; font-family: 'Malgun Gothic', sans-serif;">
                <div style="width: 65px; font-size: 12px; font-weight: bold; color: var(--text-primary);">
                    ${item.rank}위 ${item.name}
                </div>
                
                <div style="flex-grow: 1; background: rgba(0,0,0,0.05); height: 20px; border-radius: 10px; overflow: hidden; margin-left: 8px; position: relative;">
                    <div style="width: ${item.score}%; background: linear-gradient(90deg, #3498db, #2ecc71); height: 100%; border-radius: 10px; transition: width 0.4s ease-in-out; display: flex; align-items: center; justify-content: flex-end;">
                        <span style="color: white; font-size: 10px; font-weight: bold; margin-right: 8px; white-space: nowrap;">
                            ${item.score}점
                        </span>
                    </div>
                </div>
            </div>
        `;
    });

    chartHTML += `</div>`;
    document.getElementById("sidebar-rank").innerHTML = chartHTML;

    // 3. 마우스 호버 이벤트 제어
    const tooltipContainer = document.querySelector('.suin-tooltip');
    const tooltipText = document.querySelector('.suin-tooltip-text');
    
    if (tooltipContainer && tooltipText) {
        tooltipContainer.addEventListener('mouseenter', () => {
            tooltipText.style.visibility = 'visible';
            tooltipText.style.opacity = '1';
        });
        tooltipContainer.addEventListener('mouseleave', () => {
            tooltipText.style.visibility = 'hidden';
            tooltipText.style.opacity = '0';
        });
    }
}

// 🔌 친구들 데이터 시스템과 연동하는 부분
waitForData(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        const rankBlock = document.createElement('div');
        rankBlock.id = 'sidebar-rank';
        rankBlock.className = 'control-block';
        document.getElementById('sidebar-rank').appendChild(rankBlock);
    }

    // ⭐ 처음 켰을 때는 데이터의 가장 최신 연도인 2024년을 기본값으로 띄우기
    if (window.state && state.year) {
        showTop5Chart(state.year);
    } else {
        showTop5Chart("2024");
    }

    const slider = document.getElementById('yearSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            showTop5Chart(e.target.value);
        });
    }
});