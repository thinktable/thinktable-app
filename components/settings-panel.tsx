'use client'

// Settings panel component - slides in from right with semi-transparent backdrop
import { useState } from 'react'
import { X, Settings, User as UserIcon, Shield, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { User } from '@supabase/supabase-js'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
  user: User
  onDeleteAccount: () => void
  isDeleting: boolean
  showDeleteConfirm: boolean
  onShowDeleteConfirm: (show: boolean) => void
}

export function SettingsPanel({
  open,
  onClose,
  user,
  onDeleteAccount,
  isDeleting,
  showDeleteConfirm,
  onShowDeleteConfirm,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'general' | 'security'>('account')

  if (!open) return null

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Settings Panel */}
      <div className="fixed right-0 top-0 h-full w-[600px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Settings</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Navigation */}
          <div className="w-48 border-r border-gray-200 p-4 space-y-1">
            <button
              onClick={() => setActiveTab('account')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'account'
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <UserIcon className="h-4 w-4" />
              <span>Account</span>
            </button>
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'general'
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Settings className="h-4 w-4" />
              <span>General</span>
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'security'
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Shield className="h-4 w-4" />
              <span>Security</span>
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'account' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Account</h3>
                  
                  {/* User Info */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700">Email</label>
                      <p className="text-sm text-gray-600 mt-1">{user.email}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Plan</label>
                      <p className="text-sm text-gray-600 mt-1">Free Plan</p>
                    </div>
                  </div>

                  {/* Payment Section */}
                  <div className="mt-8 pt-6 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Payment</h4>
                        <p className="text-sm text-gray-500 mt-1">Manage your subscription</p>
                      </div>
                      <Button variant="outline" size="sm">
                        Manage
                      </Button>
                    </div>
                  </div>

                  {/* Delete Account Section */}
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">Delete account</h4>
                        <p className="text-sm text-gray-500 mt-1">
                          Permanently delete your account and all associated data
                        </p>
                      </div>
                      {showDeleteConfirm ? (
                        <div className="space-y-3">
                          <p className="text-sm text-red-600 font-medium">
                            Are you sure? This action cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={onDeleteAccount}
                              disabled={isDeleting}
                            >
                              {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onShowDeleteConfirm(false)}
                              disabled={isDeleting}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onShowDeleteConfirm(true)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold">General Settings</h3>
                <p className="text-sm text-gray-500">General settings coming soon...</p>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold">Security</h3>
                <p className="text-sm text-gray-500">Security settings coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

