import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format, isValid } from 'date-fns';
import { debounce } from 'lodash';
import * as yup from 'yup';
import {
  Feedback,
  FeedbackCreate,
  FeedbackUpdate,
  FeedbackType,
  FeedbackStatus,
  FeedbackPriority,
  FeedbackVisibility,
  FeedbackCategory
} from '../../types/feedback';
import { Member } from '../../types/member';
import feedbackService from '../../services/feedbackService';
import memberService from '../../services/memberService';
import LoadingSpinner from '../common/LoadingSpinner';
import Button from '../common/Button';
import Input from '../common/Input';
import TextArea from '../common/TextArea';
import Select from '../common/Select';
import DatePicker from '../common/DatePicker';
import FileUpload from '../common/FileUpload';
import RatingInput from '../common/RatingInput';
import TagsInput from '../common/TagsInput';
import MemberSelector from '../common/MemberSelector';
import RichTextEditor from '../common/RichTextEditor';
import ConfirmDialog from '../common/ConfirmDialog';
import { useDebounce } from '../../hooks/useDebounce';
import { useNotification } from '../../hooks/useNotification';
import { useFeedback } from '../../hooks/useFeedback';
import { useFormValidation } from '../../hooks/useFormValidation';

export interface FeedbackFormProps {
  feedbackId?: string;
  memberId?: string;
  organizationId?: string;
  onSubmit?: (feedback: Feedback) => void;
  onCancel?: () => void;
  mode?: 'create' | 'edit';
  initialData?: Partial<Feedback>;
  readOnly?: boolean;
}

interface FormData {
  member_id: string;
  organization_id: string;
  provider_id: string;
  content: string;
  feedback_type: FeedbackType;
  rating: number | null;
  rating_scale: number;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  visibility: FeedbackVisibility;
  status: FeedbackStatus;
  tags: string[];
  metadata: Record<string, any>;
}

interface ValidationErrors {
  [key: string]: string;
}

interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  progress?: number;
  error?: string;
}

const CONTENT_MAX_LENGTH = parseInt(process.env.REACT_APP_FEEDBACK_MAX_CONTENT_LENGTH || '5000');
const FILE_SIZE_LIMIT = parseInt(process.env.REACT_APP_FEEDBACK_FILE_SIZE_LIMIT || '10485760');
const AUTOSAVE_INTERVAL = parseInt(process.env.REACT_APP_FEEDBACK_AUTOSAVE_INTERVAL || '30000');
const MAX_TAGS = parseInt(process.env.REACT_APP_FEEDBACK_MAX_TAGS || '10');
const VALIDATION_DEBOUNCE = parseInt(process.env.REACT_APP_FORM_VALIDATION_DEBOUNCE || '500');
const MEMBER_SEARCH_DEBOUNCE = parseInt(process.env.REACT_APP_MEMBER_SEARCH_DEBOUNCE || '300');
const ENABLE_DRAFT_ENCRYPTION = process.env.REACT_APP_ENABLE_DRAFT_ENCRYPTION === 'true';

const validationSchema = yup.object().shape({
  member_id: yup.string().required('Member is required'),
  organization_id: yup.string().required('Organization is required'),
  provider_id: yup.string().email('Invalid email format').required('Provider email is required'),
  content: yup.string()
    .required('Content is required')
    .max(CONTENT_MAX_LENGTH, `Content must be less than ${CONTENT_MAX_LENGTH} characters`),
  feedback_type: yup.string().oneOf(Object.values(FeedbackType)).required('Feedback type is required'),
  rating: yup.number().nullable().min(1).max(10),
  rating_scale: yup.number().min(5).max(10).required('Rating scale is required'),
  category: yup.string().oneOf(Object.values(FeedbackCategory)).required('Category is required'),
  priority: yup.string().oneOf(Object.values(FeedbackPriority)).required('Priority is required'),
  visibility: yup.string().oneOf(Object.values(FeedbackVisibility)).required('Visibility is required'),
  status: yup.string().oneOf(Object.values(FeedbackStatus)).required('Status is required'),
  tags: yup.array().of(yup.string()).max(MAX_TAGS, `Maximum ${MAX_TAGS} tags allowed`)
});

const FeedbackForm: React.FC<FeedbackFormProps> = ({
  feedbackId,
  memberId,
  organizationId,
  onSubmit,
  onCancel,
  mode = 'create',
  initialData,
  readOnly = false
}) => {
  const { showNotification } = useNotification();
  const { refreshFeedback } = useFeedback();
  const formRef = useRef<HTMLFormElement>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout>();

  const [formData, setFormData] = useState<FormData>({
    member_id: memberId || initialData?.member_id || '',
    organization_id: organizationId || initialData?.organization_id || '',
    provider_id: initialData?.provider_id || '',
    content: initialData?.content || '',
    feedback_type: initialData?.feedback_type || FeedbackType.PERFORMANCE,
    rating: initialData?.rating || null,
    rating_scale: initialData?.rating_scale || 5,
    category: initialData?.category || FeedbackCategory.GENERAL,
    priority: initialData?.priority || FeedbackPriority.MEDIUM,
    visibility: initialData?.visibility || FeedbackVisibility.PRIVATE,
    status: initialData?.status || FeedbackStatus.DRAFT,
    tags: initialData?.tags || [],
    metadata: initialData?.metadata || {}
  });

  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [memberSearchResults, setMemberSearchResults] = useState<Member[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoadingMember, setIsLoadingMember] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const debouncedContent = useDebounce(formData.content, VALIDATION_DEBOUNCE);
  const debouncedValidation = useDebounce(formData, VALIDATION_DEBOUNCE);

  // Initialize form with existing feedback data in edit mode
  useEffect(() => {
    if (mode === 'edit' && feedbackId) {
      loadFeedbackData();
    }
    
    // Setup form validation rules
    setupValidationRules();
    
    // Initialize member search if memberId provided
    if (memberId) {
      loadMemberData(memberId);
    }

    // Restore draft from localStorage
    restoreDraft();

    return () => {
      // Cleanup
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
      saveDraft();
    };
  }, [feedbackId, mode, memberId]);

  // Auto-save functionality
  useEffect(() => {
    if (isDirty && !readOnly) {
      autoSaveTimerRef.current = setInterval(() => {
        saveDraft();
      }, AUTOSAVE_INTERVAL);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [isDirty, readOnly]);

  // Validate form on data change
  useEffect(() => {
    if (isDirty) {
      validateForm();
    }
  }, [debouncedValidation]);

  // Handle unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !readOnly) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, readOnly]);

  const loadFeedbackData = async () => {
    try {
      const feedback = await feedbackService.getFeedback(feedbackId!);
      setFormData({
        member_id: feedback.member_id,
        organization_id: feedback.organization_id,
        provider_id: feedback.provider_id,
        content: feedback.content,
        feedback_type: feedback.feedback_type,
        rating: feedback.rating,
        rating_scale: feedback.rating_scale,
        category: feedback.category,
        priority: feedback.priority,
        visibility: feedback.visibility,
        status: feedback.status,
        tags: feedback.tags || [],
        metadata: feedback.metadata || {}
      });
      
      if (feedback.member_id) {
        loadMemberData(feedback.member_id);
      }
      
      // TODO: Load attachments from feedback metadata
    } catch (error) {
      showNotification('Failed to load feedback data', 'error');
      console.error('Error loading feedback:', error);
    }
  };

  const loadMemberData = async (memberId: string) => {
    try {
      setIsLoadingMember(true);
      const member = await memberService.getMember(memberId);
      setSelectedMember(member);
    } catch (error) {
      showNotification('Failed to load member data', 'error');
      console.error('Error loading member:', error);
    } finally {
      setIsLoadingMember(false);
    }
  };

  const setupValidationRules = () => {
    // Additional custom validation rules can be added here
  };

  const saveDraft = () => {
    try {
      const draftKey = `feedback_draft_${feedbackId || 'new'}`;
      const draftData = {
        formData,
        attachments,
        timestamp: new Date().toISOString()
      };
      
      if (ENABLE_DRAFT_ENCRYPTION) {
        // TODO: Implement encryption for sensitive data
      }
      
      localStorage.setItem(draftKey, JSON.stringify(draftData));
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  };

  const restoreDraft = () => {
    try {
      const draftKey = `feedback_draft_${feedbackId || 'new'}`;
      const draftString = localStorage.getItem(draftKey);
      
      if (draftString) {
        const draft = JSON.parse(draftString);
        const draftAge = new Date().getTime() - new Date(draft.timestamp).getTime();
        
        // Only restore drafts less than 24 hours old
        if (draftAge < 24 * 60 * 60 * 1000) {
          setFormData(draft.formData);
          setAttachments(draft.attachments || []);
          showNotification('Draft restored', 'info');
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch (error) {
      console.error('Error restoring draft:', error);
    }
  };

  const clearDraft = () => {
    const draftKey = `feedback_draft_${feedbackId || 'new'}`;
    localStorage.removeItem(draftKey);
  };

  const handleInputChange = (field: keyof FormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setIsDirty(true);
    
    // Clear field error on change
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleMemberSelect = (member: Member) => {
    setSelectedMember(member);
    handleInputChange('member_id', member.id);
    handleInputChange('organization_id', member.organization_id);
    
    // Auto-populate provider if current user
    // TODO: Get current user context from auth system
  };

  const handleRatingChange = (rating: number) => {
    if (rating >= 1 && rating <= formData.rating_scale) {
      handleInputChange('rating', rating);
    }
  };

  const handleTagsChange = (tags: string[]) => {
    if (tags.length <= MAX_TAGS) {
      handleInputChange('tags', tags);
    } else {
      showNotification(`Maximum ${MAX_TAGS} tags allowed`, 'warning');
    }
  };

  const handleFileUpload = async (files: File[]) => {
    const newAttachments: Attachment[] = [];
    
    for (const file of files) {
      if (file.size > FILE_SIZE_LIMIT) {
        showNotification(`File ${file.name} exceeds size limit`, 'error');
        continue;
      }
      
      const attachment: Attachment = {
        id: `temp_${Date.now()}_${Math.random()}`,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0
      };
      
      newAttachments.push(attachment);
      
      try {
        // TODO: Implement actual file upload to storage service
        // const uploadResult = await fileStorageService.upload(file, {
        //   onProgress: (progress) => {
        //     setAttachments(prev => prev.map(a => 
        //       a.id === attachment.id ? { ...a, progress } : a
        //     ));
        //   }
        // });
        // attachment.url = uploadResult.url;
        attachment.progress = 100;
      } catch (error) {
        attachment.error = 'Upload failed';
        showNotification(`Failed to upload ${file.name}`, 'error');
      }
    }
    
    setAttachments(prev => [...prev, ...newAttachments]);
    setIsDirty(true);
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
    setIsDirty(true);
  };

  const validateForm = async (): Promise<boolean> => {
    try {
      await validationSchema.validate(formData, { abortEarly: false });
      setValidationErrors({});
      return true;
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        const errors: ValidationErrors = {};
        error.inner.forEach(err => {
          if (err.path) {
            errors[err.path] = err.message;
          }
        });
        setValidationErrors(errors);
      }
      return false;
    }
  };

  const validateField = async (field: keyof FormData): Promise<boolean> => {
    try {
      const fieldSchema = yup.reach(validationSchema, field);
      await fieldSchema.validate(formData[field]);
      
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
      
      return true;
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        setValidationErrors(prev => ({
          ...prev,
          [field]: error.message
        }));
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (readOnly) return;
    
    const isValid = await validateForm();
    if (!isValid) {
      showNotification('Please fix validation errors', 'error');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      let result: Feedback;
      
      // Prepare submission data
      const submissionData = {
        ...formData,
        metadata: {
          ...formData.metadata,
          attachments: attachments.map(a => ({
            id: a.id,
            name: a.name,
            size: a.size,
            type: a.type,
            url: a.url
          }))
        }
      };
      
      if (mode === 'edit' && feedbackId) {
        result = await feedbackService.updateFeedback(feedbackId, submissionData as FeedbackUpdate);
        showNotification('Feedback updated successfully', 'success');
      } else {
        result = await feedbackService.createFeedback(submissionData as FeedbackCreate);
        showNotification('Feedback created successfully', 'success');
      }
      
      clearDraft();
      setIsDirty(false);
      
      if (onSubmit) {
        onSubmit(result);
      }
      
      // Refresh feedback list
      refreshFeedback();
    } catch (error: any) {
      console.error('Error submitting feedback:', error);
      
      // Handle field-specific errors from API
      if (error.response?.data?.errors) {
        const apiErrors: ValidationErrors = {};
        Object.entries(error.response.data.errors).forEach(([field, message]) => {
          apiErrors[field] = message as string;
        });
        setValidationErrors(apiErrors);
      }
      
      showNotification(
        error.response?.data?.message || 'Failed to submit feedback',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (isDirty && !readOnly) {
      setShowConfirmDialog(true);
    } else {
      performCancel();
    }
  };

  const performCancel = () => {
    resetForm();
    if (onCancel) {
      onCancel();
    }
  };

  const resetForm = () => {
    setFormData({
      member_id: memberId || '',
      organization_id: organizationId || '',
      provider_id: '',
      content: '',
      feedback_type: FeedbackType.PERFORMANCE,
      rating: null,
      rating_scale: 5,
      category: FeedbackCategory.GENERAL,
      priority: FeedbackPriority.MEDIUM,
      visibility: FeedbackVisibility.PRIVATE,
      status: FeedbackStatus.DRAFT,
      tags: [],
      metadata: {}
    });
    setValidationErrors({});
    setAttachments([]);
    setIsDirty(false);
    setSelectedMember(null);
  };

  const searchMembers = useCallback(
    debounce(async (searchTerm: string) => {
      if (!searchTerm || searchTerm.length < 2) {
        setMemberSearchResults([]);
        return;
      }
      
      try {
        const results = await memberService.searchMembers({
          search: searchTerm,
          organization_id: formData.organization_id,
          limit: 10
        });
        setMemberSearchResults(results.items);
      } catch (error) {
        console.error('Error searching members:', error);
        showNotification('Failed to search members', 'error');
      }
    }, MEMBER_SEARCH_DEBOUNCE),
    [formData.organization_id]
  );

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="feedback-form" noValidate>
        <div className="form-section">
          <h3 className="form-section-title">Basic Information</h3>
          
          <div className="form-group">
            <label htmlFor="member" className="form-label required">
              Member
            </label>
            <MemberSelector
              id="member"
              value={selectedMember}
              onChange={handleMemberSelect}
              onSearch={searchMembers}
              searchResults={memberSearchResults}
              loading={isLoadingMember}
              disabled={readOnly}
              error={validationErrors.member_id}
              aria-label="Select member"
              aria-required="true"
              aria-invalid={!!validationErrors.member_id}
              aria-describedby={validationErrors.member_id ? "member-error" : undefined}
            />
            {validationErrors.member_id && (
              <span id="member-error" className="form-error" role="alert">
                {validationErrors.member_id}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="provider_id" className="form-label required">
              Provider Email
            </label>
            <Input
              id="provider_id"
              type="email"
              value={formData.provider_id}
              onChange={(e) => handleInputChange('provider_id', e.target.value)}
              onBlur={() => validateField('provider_id')}
              disabled={readOnly}
              error={validationErrors.provider_id}
              placeholder="provider@example.com"
              aria-label="Provider email"
              aria-required="true"
              aria-invalid={!!validationErrors.provider_id}
              aria-describedby={validationErrors.provider_id ? "provider-error" : undefined}
            />
            {validationErrors.provider_id && (
              <span id="provider-error" className="form-error" role="alert">
                {validationErrors.provider_id}
              </span>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="feedback_type" className="form-label required">
                Feedback Type
              </label>
              <Select
                id="feedback_type"
                value={formData.feedback_type}
                onChange={(e) => handleInputChange('feedback_type', e.target.value)}
                disabled={readOnly}
                error={validationErrors.feedback_type}
                aria-label="Feedback type"
                aria-required="true"
              >
                {Object.entries(FeedbackType).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>

            <div className="form-group">
              <label htmlFor="category" className="form-label required">
                Category
              </label>
              <Select
                id="category"
                value={formData.category}
                onChange={(e) => handleInputChange('category', e.target.value)}
                disabled={readOnly}
                error={validationErrors.category}
                aria-label="Category"
                aria-required="true"
              >
                {Object.entries(FeedbackCategory).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="form-section-title">Feedback Content</h3>
          
          <div className="form-group">
            <label htmlFor="content" className="form-label required">
              Content
              <span className="form-label-hint">
                {formData.content.length}/{CONTENT_MAX_LENGTH} characters
              </span>
            </label>
            <RichTextEditor
              id="content"
              value={formData.content}
              onChange={(value) => handleInputChange('content', value)}
              onBlur={() => validateField('content')}
              disabled={readOnly}
              error={validationErrors.content}
              maxLength={CONTENT_MAX_LENGTH}
              placeholder="Enter feedback content..."
              aria-label="Feedback content"
              aria-required="true"
              aria-invalid={!!validationErrors.content}
              aria-describedby={validationErrors.content ? "content-error" : undefined}
            />
            {validationErrors.content && (
              <span id="content-error" className="form-error" role="alert">
                {validationErrors.content}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="rating" className="form-label">
              Rating
              <span className="form-label-hint">
                Scale: 1-{formData.rating_scale}
              </span>
            </label>
            <RatingInput
              id="rating"
              value={formData.rating || 0}
              onChange={handleRatingChange}
              max={formData.rating_scale}
              disabled={readOnly}
              error={validationErrors.rating}
              aria-label={`Rating out of ${formData.rating_scale}`}
            />
          </div>

          <div className="form-group">
            <label htmlFor="tags" className="form-label">
              Tags
              <span className="form-label-hint">
                {formData.tags.length}/{MAX_TAGS} tags
              </span>
            </label>
            <TagsInput
              id="tags"
              value={formData.tags}
              onChange={handleTagsChange}
              disabled={readOnly}
              maxTags={MAX_TAGS}
              placeholder="Add tags..."
              aria-label="Feedback tags"
              aria-describedby="tags-hint"
            />
            <span id="tags-hint" className="form-hint">
              Press Enter to add a tag
            </span>
          </div>
        </div>

        <div className="form-section">
          <h3 className="form-section-title">Settings</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="priority" className="form-label required">
                Priority
              </label>
              <Select
                id="priority"
                value={formData.priority}
                onChange={(e) => handleInputChange('priority', e.target.value)}
                disabled={readOnly}
                error={validationErrors.priority}
                aria-label="Priority"
                aria-required="true"
              >
                {Object.entries(FeedbackPriority).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key}
                  </option>
                ))}
              </Select>
            </div>

            <div className="form-group">
              <label htmlFor="visibility" className="form-label required">
                Visibility
              </label>
              <Select
                id="visibility"
                value={formData.visibility}
                onChange={(e) => handleInputChange('visibility', e.target.value)}
                disabled={readOnly}
                error={validationErrors.visibility}
                aria-label="Visibility"
                aria-required="true"
              >
                {Object.entries(FeedbackVisibility).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key}
                  </option>
                ))}
              </Select>
            </div>

            <div className="form-group">
              <label htmlFor="status" className="form-label required">
                Status
              </label>
              <Select
                id="status"
                value={formData.status}
                onChange={(e) => handleInputChange('status', e.target.value)}
                disabled={readOnly}
                error={validationErrors.status}
                aria-label="Status"
                aria-required="true"
              >
                {Object.entries(FeedbackStatus).map(([key, value]) => (
                  <option key={value} value={value}>
                    {key}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="form-section-title">Attachments</h3>
          
          <FileUpload
            onUpload={handleFileUpload}
            disabled={readOnly}
            maxSize={FILE_SIZE_LIMIT}
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            multiple
            aria-label="Upload attachments"
          />
          
          {attachments.length > 0 && (
            <div className="attachments-list" role="list" aria-label="Uploaded attachments">
              {attachments.map(attachment => (
                <div key={attachment.id} className="attachment-item" role="listitem">
                  <span className="attachment-name">{attachment.name}</span>
                  <span className="attachment-size">
                    {(attachment.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  {attachment.progress !== undefined && attachment.progress < 100 && (
                    <div className="attachment-progress">
                      <div 
                        className="attachment-progress-bar"
                        style={{ width: `${attachment.progress}%` }}
                        role="progressbar"
                        aria-valuenow={attachment.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                  )}
                  {attachment.error && (
                    <span className="attachment-error" role="alert">{attachment.error}</span>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="attachment-remove"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="form-actions">
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || Object.keys(validationErrors).length > 0}
              loading={isSubmitting}
              aria-label={mode === 'edit' ? 'Update feedback' : 'Create feedback'}
            >
              {isSubmitting ? 'Saving...' : mode === 'edit' ? 'Update' : 'Create'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={isSubmitting}
              aria-label="Cancel"
            >
              Cancel
            </Button>
            {isDirty && (
              <span className="form-status" role="status" aria-live="polite">
                Unsaved changes
              </span>
            )}
          </div>
        )}
      </form>

      <ConfirmDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={() => {
          setShowConfirmDialog(false);
          performCancel();
        }}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to cancel?"
        confirmText="Discard Changes"
        cancelText="Keep Editing"
      />
    </>
  );
};

export default FeedbackForm;