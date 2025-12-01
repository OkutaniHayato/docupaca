"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { Organization, OcrSetting } from '@/types/ocr';
import {
  LayoutDashboard,
  Settings,
  History,
  KeyRound,
  LogOut,
  GraduationCap,
  Building2,
  FolderOpen,
  Folder,
  FileText,
  ChevronDown,
  ChevronRight,
  BookOpen
} from 'lucide-react';

interface OrganizationWithId extends Organization {
  id: string;
}

interface OcrSettingWithId extends OcrSetting {
  id: string;
}

const menuItems = [
  {
    name: 'ダッシュボード',
    href: '/dashboard',
    icon: LayoutDashboard
  },
  {
    name: '実行履歴',
    href: '/dashboard/history',
    icon: History
  },
  {
    name: '学習設定',
    href: '/dashboard/learning',
    icon: GraduationCap
  },
  {
    name: 'APIキー',
    href: '/dashboard/apikeys',
    icon: KeyRound
  },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const { currentUser, logout } = useAuth();

  // 組織一覧
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);
  // OCR設定一覧
  const [ocrSettings, setOcrSettings] = useState<OcrSettingWithId[]>([]);
  // 展開中の組織フォルダ
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  // OCR設定セクションの展開状態
  const [isOcrSectionExpanded, setIsOcrSectionExpanded] = useState(true);

  // 組織一覧を取得
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'organizations'),
      where('owner_id', '==', currentUser.uid),
      orderBy('name', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orgs: OrganizationWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OrganizationWithId));
      setOrganizations(orgs);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // OCR設定一覧を取得
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'ocr_settings'),
      where('owner_id', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const settings: OcrSettingWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OcrSettingWithId));
      setOcrSettings(settings);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // 組織ごとにグループ化
  const settingsByOrg = React.useMemo(() => {
    const grouped: Record<string, OcrSettingWithId[]> = {};
    const unassigned: OcrSettingWithId[] = [];

    ocrSettings.forEach(setting => {
      if (setting.organization_id) {
        if (!grouped[setting.organization_id]) {
          grouped[setting.organization_id] = [];
        }
        grouped[setting.organization_id].push(setting);
      } else {
        unassigned.push(setting);
      }
    });

    return { grouped, unassigned };
  }, [ocrSettings]);

  const toggleOrgExpanded = (orgId: string) => {
    setExpandedOrgs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orgId)) {
        newSet.delete(orgId);
      } else {
        newSet.add(orgId);
      }
      return newSet;
    });
  };

  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto">
      {/* --- 上部メニュー --- */}
      <nav className="mt-4 space-y-1">
        {/* 基本メニュー */}
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center rounded px-4 py-2.5 transition duration-200 ${
                isActive
                  ? 'bg-green-700 text-white'
                  : 'text-white hover:bg-green-700'
              }`}
            >
              <item.icon className="mr-3 h-5 w-5" />
              {item.name}
            </Link>
          );
        })}

        {/* 組織マスタ */}
        <Link
          href="/dashboard/organizations"
          className={`flex items-center rounded px-4 py-2.5 transition duration-200 ${
            pathname === '/dashboard/organizations'
              ? 'bg-green-700 text-white'
              : 'text-white hover:bg-green-700'
          }`}
        >
          <Building2 className="mr-3 h-5 w-5" />
          組織マスタ
        </Link>

        {/* ナレッジ管理 */}
        <Link
          href="/dashboard/knowledge"
          className={`flex items-center rounded px-4 py-2.5 transition duration-200 ${
            pathname === '/dashboard/knowledge'
              ? 'bg-green-700 text-white'
              : 'text-white hover:bg-green-700'
          }`}
        >
          <BookOpen className="mr-3 h-5 w-5" />
          ナレッジ管理
        </Link>

        {/* OCR設定セクション */}
        <div className="pt-4 border-t border-green-600">
          <button
            onClick={() => setIsOcrSectionExpanded(!isOcrSectionExpanded)}
            className="flex items-center justify-between w-full px-4 py-2 text-sm font-semibold text-green-200 hover:text-white"
          >
            <span className="flex items-center">
              <Settings className="mr-2 h-4 w-4" />
              OCR設定
            </span>
            {isOcrSectionExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {isOcrSectionExpanded && (
            <div className="mt-1 space-y-0.5">
              {/* 全設定へのリンク */}
              <Link
                href="/dashboard/settings"
                className={`flex items-center rounded px-4 py-2 text-sm transition duration-200 ${
                  pathname === '/dashboard/settings'
                    ? 'bg-green-700 text-white'
                    : 'text-white hover:bg-green-700'
                }`}
              >
                <FileText className="mr-2 h-4 w-4" />
                全ての設定
              </Link>

              {/* 組織ごとのフォルダ */}
              {organizations.map(org => {
                const orgSettings = settingsByOrg.grouped[org.id] || [];
                const isExpanded = expandedOrgs.has(org.id);
                const hasSettings = orgSettings.length > 0;

                return (
                  <div key={org.id}>
                    <button
                      onClick={() => toggleOrgExpanded(org.id)}
                      className="flex items-center justify-between w-full px-4 py-2 text-sm text-white hover:bg-green-700 rounded transition duration-200"
                    >
                      <span className="flex items-center">
                        {isExpanded ? (
                          <FolderOpen className="mr-2 h-4 w-4 text-yellow-400" />
                        ) : (
                          <Folder className="mr-2 h-4 w-4 text-yellow-400" />
                        )}
                        <span className="truncate max-w-[140px]">{org.name}</span>
                        <span className="ml-1 text-xs text-green-300">({orgSettings.length})</span>
                      </span>
                      {hasSettings && (
                        isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )
                      )}
                    </button>

                    {/* 展開時：設定一覧 */}
                    {isExpanded && hasSettings && (
                      <div className="ml-6 space-y-0.5">
                        {orgSettings.map(setting => (
                          <Link
                            key={setting.id}
                            href={`/dashboard/settings/edit/${setting.id}`}
                            className={`flex items-center rounded px-3 py-1.5 text-xs transition duration-200 ${
                              pathname === `/dashboard/settings/edit/${setting.id}`
                                ? 'bg-green-600 text-white'
                                : 'text-green-100 hover:bg-green-700 hover:text-white'
                            }`}
                          >
                            <FileText className="mr-2 h-3 w-3" />
                            <span className="truncate">{setting.name}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 未分類の設定 */}
              {settingsByOrg.unassigned.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleOrgExpanded('_unassigned')}
                    className="flex items-center justify-between w-full px-4 py-2 text-sm text-white hover:bg-green-700 rounded transition duration-200"
                  >
                    <span className="flex items-center">
                      {expandedOrgs.has('_unassigned') ? (
                        <FolderOpen className="mr-2 h-4 w-4 text-gray-400" />
                      ) : (
                        <Folder className="mr-2 h-4 w-4 text-gray-400" />
                      )}
                      <span className="text-green-200">未分類</span>
                      <span className="ml-1 text-xs text-green-300">({settingsByOrg.unassigned.length})</span>
                    </span>
                    {expandedOrgs.has('_unassigned') ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </button>

                  {expandedOrgs.has('_unassigned') && (
                    <div className="ml-6 space-y-0.5">
                      {settingsByOrg.unassigned.map(setting => (
                        <Link
                          key={setting.id}
                          href={`/dashboard/settings/edit/${setting.id}`}
                          className={`flex items-center rounded px-3 py-1.5 text-xs transition duration-200 ${
                            pathname === `/dashboard/settings/edit/${setting.id}`
                              ? 'bg-green-600 text-white'
                              : 'text-green-100 hover:bg-green-700 hover:text-white'
                          }`}
                        >
                          <FileText className="mr-2 h-3 w-3" />
                          <span className="truncate">{setting.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 新規作成リンク */}
              <Link
                href="/dashboard/settings/new"
                className={`flex items-center rounded px-4 py-2 text-sm transition duration-200 ${
                  pathname === '/dashboard/settings/new'
                    ? 'bg-green-700 text-white'
                    : 'text-green-200 hover:bg-green-700 hover:text-white'
                }`}
              >
                <span className="mr-2">+</span>
                新規作成
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* --- 下部メニュー（ログアウト） --- */}
      <div className="pb-4">
        <button
          onClick={() => logout()}
          className="flex w-full items-center rounded px-4 py-2.5 text-white transition duration-200 hover:bg-green-700"
        >
          <LogOut className="mr-3 h-5 w-5" />
          ログアウト
        </button>
      </div>
    </div>
  );
}
