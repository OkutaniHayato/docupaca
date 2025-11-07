import React from 'react';

/**
 * ダッシュボード トップページ
 * モックアップ要件 [cite: 168, 169] に基づく
 */
export default function DashboardPage() {
  return (
    <div>
      {/* * h2 スタイル [cite: 63]
      */}
      <h2 className="mb-4 text-2xl font-bold text-gray-800">
        OCR設定一覧
      </h2>

      {/* * TODO: Firestore の ocr_settings からデータを取得し、
        * カード形式で一覧表示する [cite: 168]
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* カード (仮のプレースホルダー) */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-green-800">請求書Aパターン</h3>
          <p className="text-sm text-gray-500">作成日: 2025-11-08</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-green-800">領収書Bパターン</h3>
          <p className="text-sm text-gray-500">作成日: 2025-11-07</p>
        </div>
      </div>

      {/* * h2 スタイル [cite: 63]
      */}
      <h2 className="mt-8 mb-4 text-2xl font-bold text-gray-800">
        最近の実行履歴
      </h2>

      {/* * TODO: Firestore の ocr_history からデータを取得し、
        * リストまたは表形式で表示する [cite: 169]
      */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600">ステータス</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">帳票名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">実行日時</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b hover:bg-gray-50">
              <td className="p-3">
                {/* Success カラー [cite: 56] */}
                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                  Completed
                </span>
              </td>
              <td className="p-3 text-sm text-gray-700">invoice_001.pdf</td>
              <td className="p-3 text-sm text-gray-500">2025-11-08 05:30</td>
            </tr>
            <tr className="border-b hover:bg-gray-50">
              <td className="p-3">
                {/* Error カラー [cite: 57] */}
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
                  Failed
                </span>
              </td>
              <td className="p-3 text-sm text-gray-700">receipt_002.png</td>
              <td className="p-3 text-sm text-gray-500">2025-11-08 05:28</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}