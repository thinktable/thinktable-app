'use client'

// Upgrade panel component - slides in from right with semi-transparent backdrop, similar to settings panel
import { X, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { User } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'

interface UpgradePanelProps {
  open: boolean
  onClose: () => void
  user: User
}

export function UpgradePanel({
  open,
  onClose,
  user,
}: UpgradePanelProps) {
  if (!open) return null

  // Handle subscription selection - TODO: Implement Stripe integration
  const handleSelectPlan = async (planType: 'monthly' | 'yearly') => {
    // TODO: Implement Stripe checkout flow
    console.log(`Selected ${planType} plan`)
    // Example: Redirect to Stripe checkout or open Stripe checkout modal
  }

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Upgrade Panel */}
      <div className="fixed right-0 top-0 h-full w-[600px] bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">Upgrade</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Header Section */}
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <h3 className="text-2xl font-semibold dark:text-white">Upgrade to Plus</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Unlock all features and get the most out of ThinkTable
              </p>
            </div>

            {/* Pricing Options */}
            <div className="space-y-4">
              {/* Monthly Plan */}
              <button
                onClick={() => handleSelectPlan('monthly')}
                className={cn(
                  'w-full p-4 rounded-lg border-2 transition-all text-left',
                  'border-gray-200 dark:border-gray-700',
                  'hover:border-blue-500 dark:hover:border-blue-400',
                  'bg-white dark:bg-gray-800'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-lg font-semibold dark:text-white">Monthly</h4>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Billed monthly
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold dark:text-white">$2.49</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">/month</span>
                    </div>
                  </div>
                  <div className="ml-4">
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center">
                      <Check className="h-3 w-3 text-white hidden" />
                    </div>
                  </div>
                </div>
              </button>

              {/* Yearly Plan */}
              <button
                onClick={() => handleSelectPlan('yearly')}
                className={cn(
                  'w-full p-4 rounded-lg border-2 transition-all text-left',
                  'border-blue-500 dark:border-blue-400',
                  'bg-blue-50 dark:bg-blue-900/20',
                  'hover:border-blue-600 dark:hover:border-blue-500'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-lg font-semibold dark:text-white">Yearly</h4>
                      <span className="text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                        Best Value
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Billed annually
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold dark:text-white">$24</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">/year</span>
                    </div>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      Save 20% compared to monthly
                    </p>
                  </div>
                  <div className="ml-4">
                    <div className="w-5 h-5 rounded-full border-2 border-blue-500 dark:border-blue-400 bg-blue-500 dark:bg-blue-400 flex items-center justify-center">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* Features List */}
            <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
              <h4 className="text-sm font-semibold mb-4 dark:text-white">What&apos;s included:</h4>
              <ul className="space-y-3">
                {[
                  'Unlimited conversations',
                  'Advanced AI models',
                  'Priority support',
                  'Early access to new features',
                  'Export and backup options',
                ].map((feature, index) => (
                  <li key={index} className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="pt-6 space-y-3">
              <Button
                onClick={() => handleSelectPlan('yearly')}
                className="w-full"
                size="lg"
              >
                Upgrade to Yearly Plan - $24/year
              </Button>
              <Button
                onClick={() => handleSelectPlan('monthly')}
                variant="outline"
                className="w-full"
                size="lg"
              >
                Upgrade to Monthly Plan - $2.49/month
              </Button>
            </div>

            {/* Footer Note */}
            <p className="text-xs text-center text-gray-500 dark:text-gray-400 pt-4">
              You can cancel anytime. All plans include a 7-day free trial.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

