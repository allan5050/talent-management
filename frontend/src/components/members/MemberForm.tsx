import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format, parseISO, differenceInYears, isValid, isBefore, isAfter } from 'date-fns';
import { debounce, isEqual, cloneDeep, isEmpty, pick } from 'lodash';
import * as yup from 'yup';
import { useForm, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import memberService from '../../services/memberService';
import organizationService from '../../services/organizationService';
import {
  Member,
  MemberCreate,
  MemberUpdate,
  EmploymentStatus,
  EmploymentType,
  Gender,
  Department,
  SkillProficiencyLevel,
  Skill,
  Education,
  WorkExperience,
  EmergencyContact,
  SocialLink,
  Language,
  AccessibilityNeed
} from '../../types/member';
import { Organization } from '../../types/organization';
import LoadingSpinner from '../common/LoadingSpinner';
import Button from '../common/Button';
import Input from '../common/Input';
import TextArea from '../common/TextArea';
import Select from '../common/Select';
import DatePicker from '../common/DatePicker';
import FileUpload from '../common/FileUpload';
import Checkbox from '../common/Checkbox';
import RadioGroup from '../common/RadioGroup';
import AddressInput from '../common/AddressInput';
import PhoneInput from '../common/PhoneInput';
import SkillsInput from '../common/SkillsInput';
import MemberSelector from '../common/MemberSelector';
import ProfilePictureUpload from '../common/ProfilePictureUpload';
import OrganizationalChart from '../common/OrganizationalChart';
import ConfirmDialog from '../common/ConfirmDialog';
import FormSection from '../common/FormSection';
import ValidationMessage from '../common/ValidationMessage';
import { useDebounce } from '../../hooks/useDebounce';
import { useNotification } from '../../hooks/useNotification';
import { useMembers } from '../../hooks/useMembers';
import { useAuth } from '../../hooks/useAuth';
import { useFormValidation } from '../../hooks/useFormValidation';
import { useOrganization } from '../../hooks/useOrganization';

// Environment variables with defaults
const MAX_BIO_LENGTH = parseInt(process.env.REACT_APP_MEMBER_MAX_BIO_LENGTH || '1000');
const PROFILE_PICTURE_SIZE_LIMIT = parseInt(process.env.REACT_APP_MEMBER_PROFILE_PICTURE_SIZE_LIMIT || '5242880'); // 5MB
const AUTOSAVE_INTERVAL = parseInt(process.env.REACT_APP_MEMBER_AUTOSAVE_INTERVAL || '30000');
const MAX_SKILLS = parseInt(process.env.REACT_APP_MEMBER_MAX_SKILLS || '20');
const FORM_VALIDATION_DEBOUNCE = parseInt(process.env.REACT_APP_MEMBER_FORM_VALIDATION_DEBOUNCE || '500');
const MANAGER_SEARCH_DEBOUNCE = parseInt(process.env.REACT_APP_MANAGER_SEARCH_DEBOUNCE || '300');
const ENABLE_DRAFT_ENCRYPTION = process.env.REACT_APP_ENABLE_MEMBER_DRAFT_ENCRYPTION !== 'false';
const MAX_HIERARCHY_DEPTH = parseInt(process.env.REACT_APP_MAX_MEMBER_HIERARCHY_DEPTH || '10');
const MIN_SALARY = parseInt(process.env.REACT_APP_MIN_SALARY || '0');
const MAX_SALARY = parseInt(process.env.REACT_APP_MAX_SALARY || '10000000');
const MAX_EMERGENCY_CONTACTS = parseInt(process.env.REACT_APP_MAX_EMERGENCY_CONTACTS || '3');

export interface MemberFormProps {
  memberId?: string;
  organizationId?: string;
  managerId?: string;
  onSubmit?: (member: Member) => void;
  onCancel?: () => void;
  mode?: 'create' | 'edit' | 'view';
  initialData?: Partial<Member>;
  readOnly?: boolean;
  showAdvancedFields?: boolean;
  allowManagerChange?: boolean;
}

interface FormData extends Omit<MemberCreate, 'organization_id'> {
  organization_id?: string;
  id?: string;
  created_at?: string;
  updated_at?: string;
}

interface FormSectionState {
  personalInfo: boolean;
  employmentInfo: boolean;
  skillsCompetencies: boolean;
  contactDetails: boolean;
  additionalInfo: boolean;
}

const validationSchema = yup.object().shape({
  first_name: yup.string().required('First name is required').max(100),
  last_name: yup.string().required('Last name is required').max(100),
  email: yup.string().required('Email is required').email('Invalid email format'),
  phone: yup.string().nullable(),
  date_of_birth: yup.date().nullable()
    .max(new Date(), 'Date of birth cannot be in the future')
    .test('age', 'Must be at least 16 years old', (value) => {
      if (!value) return true;
      return differenceInYears(new Date(), value) >= 16;
    }),
  gender: yup.mixed<Gender>().oneOf(Object.values(Gender)).nullable(),
  street_address: yup.string().nullable().max(255),
  city: yup.string().nullable().max(100),
  state: yup.string().nullable().max(100),
  postal_code: yup.string().nullable().max(20),
  country: yup.string().nullable().max(100),
  employee_id: yup.string().required('Employee ID is required').max(50),
  job_title: yup.string().required('Job title is required').max(100),
  department: yup.string().required('Department is required'),
  manager_id: yup.string().nullable(),
  employment_status: yup.mixed<EmploymentStatus>()
    .oneOf(Object.values(EmploymentStatus))
    .required('Employment status is required'),
  employment_type: yup.mixed<EmploymentType>()
    .oneOf(Object.values(EmploymentType))
    .required('Employment type is required'),
  hire_date: yup.date().required('Hire date is required')
    .max(new Date(), 'Hire date cannot be in the future'),
  termination_date: yup.date().nullable()
    .when('hire_date', (hire_date, schema) => {
      return hire_date ? schema.min(hire_date, 'Termination date must be after hire date') : schema;
    }),
  salary: yup.number().nullable()
    .min(MIN_SALARY, `Salary must be at least ${MIN_SALARY}`)
    .max(MAX_SALARY, `Salary cannot exceed ${MAX_SALARY}`),
  salary_currency: yup.string().nullable().max(3),
  bio: yup.string().nullable().max(MAX_BIO_LENGTH, `Bio cannot exceed ${MAX_BIO_LENGTH} characters`),
  skills: yup.array().of(
    yup.object().shape({
      name: yup.string().required(),
      proficiency: yup.mixed<SkillProficiencyLevel>().oneOf(Object.values(SkillProficiencyLevel)),
      years_of_experience: yup.number().min(0).nullable(),
      certified: yup.boolean()
    })
  ).max(MAX_SKILLS, `Cannot have more than ${MAX_SKILLS} skills`),
  emergency_contacts: yup.array().of(
    yup.object().shape({
      name: yup.string().required('Emergency contact name is required'),
      phone: yup.string().required('Emergency contact phone is required'),
      relationship: yup.string().required('Relationship is required')
    })
  ).max(MAX_EMERGENCY_CONTACTS, `Cannot have more than ${MAX_EMERGENCY_CONTACTS} emergency contacts`)
});

const MemberForm: React.FC<MemberFormProps> = ({
  memberId,
  organizationId,
  managerId,
  onSubmit,
  onCancel,
  mode = 'create',
  initialData,
  readOnly = false,
  showAdvancedFields = false,
  allowManagerChange = true
}) => {
  const { user, hasPermission } = useAuth();
  const { showNotification } = useNotification();
  const { refreshMembers } = useMembers();
  const { organizations, departments, policies } = useOrganization();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [managerSearchResults, setManagerSearchResults] = useState<Member[]>([]);
  const [skillSuggestions, setSkillSuggestions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);
  const [formSections, setFormSections] = useState<FormSectionState>({
    personalInfo: true,
    employmentInfo: true,
    skillsCompetencies: showAdvancedFields,
    contactDetails: showAdvancedFields,
    additionalInfo: showAdvancedFields
  });
  const [managerSearchQuery, setManagerSearchQuery] = useState('');
  const [isSearchingManager, setIsSearchingManager] = useState(false);
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);
  
  const formRef = useRef<HTMLFormElement>(null);
  const debouncedManagerSearch = useDebounce(managerSearchQuery, MANAGER_SEARCH_DEBOUNCE);
  const debouncedValidation = useDebounce(FORM_VALIDATION_DEBOUNCE);

  const {
    control,
    handleSubmit: handleFormSubmit,
    formState: { errors, dirtyFields },
    watch,
    setValue,
    getValues,
    reset,
    trigger
  } = useForm<FormData>({
    resolver: yupResolver(validationSchema),
    mode: 'onChange',
    defaultValues: {
      ...initialData,
      organization_id: organizationId,
      manager_id: managerId,
      skills: initialData?.skills || [],
      emergency_contacts: initialData?.emergency_contacts || [],
      education: initialData?.education || [],
      work_experience: initialData?.work_experience || [],
      social_links: initialData?.social_links || [],
      languages: initialData?.languages || [],
      accessibility_needs: initialData?.accessibility_needs || []
    }
  });

  const watchedValues = watch();

  // Initialize component and load data
  useEffect(() => {
    const initializeForm = async () => {
      try {
        // Check permissions
        if (!hasPermission('member:write')) {
          showNotification('error', 'You do not have permission to manage members');
          onCancel?.();
          return;
        }

        // Load member data in edit mode
        if (mode === 'edit' && memberId) {
          const member = await memberService.getMember(memberId);
          reset(member);
        }

        // Load departments
        if (organizationId) {
          const org = await organizationService.getOrganization(organizationId);
          setDepartmentOptions(org.departments || []);
        }

        // Restore draft from localStorage
        const draftKey = `member-form-draft-${memberId || 'new'}`;
        const savedDraft = localStorage.getItem(draftKey);
        if (savedDraft && !memberId) {
          try {
            const draft = JSON.parse(savedDraft);
            if (ENABLE_DRAFT_ENCRYPTION) {
              // TODO: Decrypt draft data
            }
            reset(draft);
            showNotification('info', 'Draft restored from previous session');
          } catch (error) {
            console.error('Failed to restore draft:', error);
          }
        }
      } catch (error) {
        console.error('Failed to initialize form:', error);
        showNotification('error', 'Failed to load form data');
      }
    };

    initializeForm();

    // Cleanup on unmount
    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }
    };
  }, [memberId, mode, organizationId, reset, hasPermission, showNotification, onCancel]);

  // Manager search effect
  useEffect(() => {
    const searchManagers = async () => {
      if (!debouncedManagerSearch || debouncedManagerSearch.length < 2) {
        setManagerSearchResults([]);
        return;
      }

      setIsSearchingManager(true);
      try {
        const results = await memberService.searchMembers({
          search: debouncedManagerSearch,
          organization_id: organizationId,
          employment_status: EmploymentStatus.ACTIVE,
          limit: 10
        });

        // Filter out circular relationships
        const filteredResults = results.data.filter(member => {
          if (memberId && member.id === memberId) return false;
          // TODO: Check for circular reporting relationships
          return true;
        });

        setManagerSearchResults(filteredResults);
      } catch (error) {
        console.error('Manager search failed:', error);
        showNotification('error', 'Failed to search for managers');
      } finally {
        setIsSearchingManager(false);
      }
    };

    searchManagers();
  }, [debouncedManagerSearch, organizationId, memberId, showNotification]);

  // Skills autocomplete effect
  useEffect(() => {
    const loadSkillSuggestions = async () => {
      try {
        const jobTitle = watchedValues.job_title;
        const department = watchedValues.department;
        
        if (jobTitle || department) {
          // TODO: Fetch skill suggestions from skill taxonomy service
          const suggestions = await memberService.getSkillSuggestions({
            job_title: jobTitle,
            department: department
          });
          setSkillSuggestions(suggestions);
        }
      } catch (error) {
        console.error('Failed to load skill suggestions:', error);
      }
    };

    loadSkillSuggestions();
  }, [watchedValues.job_title, watchedValues.department]);

  // Auto-save effect
  useEffect(() => {
    if (!isDirty || mode === 'view') return;

    const saveTimer = setTimeout(() => {
      const draftKey = `member-form-draft-${memberId || 'new'}`;
      const formData = getValues();
      
      try {
        let draftData = JSON.stringify(formData);
        if (ENABLE_DRAFT_ENCRYPTION) {
          // TODO: Encrypt draft data
        }
        localStorage.setItem(draftKey, draftData);
      } catch (error) {
        console.error('Failed to save draft:', error);
      }
    }, AUTOSAVE_INTERVAL);

    setAutoSaveTimer(saveTimer);

    return () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
    };
  }, [watchedValues, isDirty, mode, memberId, getValues]);

  // Unsaved changes detection
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !isSubmitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, isSubmitting]);

  // Track dirty state
  useEffect(() => {
    setIsDirty(!isEmpty(dirtyFields));
  }, [dirtyFields]);

  const handleManagerSelect = useCallback((manager: Member | null) => {
    if (!allowManagerChange && mode === 'edit') {
      showNotification('warning', 'Manager changes are not allowed for this member');
      return;
    }

    setValue('manager_id', manager?.id || null, { shouldDirty: true });
    setManagerSearchQuery('');
    setManagerSearchResults([]);
  }, [allowManagerChange, mode, setValue, showNotification]);

  const handleSkillsChange = useCallback((skills: Skill[]) => {
    if (skills.length > MAX_SKILLS) {
      showNotification('warning', `Cannot add more than ${MAX_SKILLS} skills`);
      return;
    }

    setValue('skills', skills, { shouldDirty: true, shouldValidate: true });
  }, [setValue, showNotification]);

  const handleProfilePictureUpload = useCallback(async (file: File) => {
    if (file.size > PROFILE_PICTURE_SIZE_LIMIT) {
      showNotification('error', `Profile picture must be less than ${PROFILE_PICTURE_SIZE_LIMIT / 1024 / 1024}MB`);
      return;
    }

    setProfilePictureFile(file);
    
    try {
      // TODO: Upload to file storage service
      const uploadedUrl = await memberService.uploadProfilePicture(file);
      setValue('profile_picture_url', uploadedUrl, { shouldDirty: true });
      showNotification('success', 'Profile picture uploaded successfully');
    } catch (error) {
      console.error('Profile picture upload failed:', error);
      showNotification('error', 'Failed to upload profile picture');
    }
  }, [setValue, showNotification]);

  const handleAddressChange = useCallback((address: any) => {
    setValue('street_address', address.street_address, { shouldDirty: true });
    setValue('city', address.city, { shouldDirty: true });
    setValue('state', address.state, { shouldDirty: true });
    setValue('postal_code', address.postal_code, { shouldDirty: true });
    setValue('country', address.country, { shouldDirty: true });
    setValue('location', address.location, { shouldDirty: true });
  }, [setValue]);

  const handleEmergencyContactChange = useCallback((contacts: EmergencyContact[]) => {
    if (contacts.length > MAX_EMERGENCY_CONTACTS) {
      showNotification('warning', `Cannot add more than ${MAX_EMERGENCY_CONTACTS} emergency contacts`);
      return;
    }

    setValue('emergency_contacts', contacts, { shouldDirty: true, shouldValidate: true });
  }, [setValue, showNotification]);

  const validateBusinessRules = useCallback(async (data: FormData): Promise<boolean> => {
    try {
      // Validate organizational hierarchy
      if (data.manager_id) {
        const hierarchyDepth = await memberService.getHierarchyDepth(data.manager_id);
        if (hierarchyDepth >= MAX_HIERARCHY_DEPTH) {
          showNotification('error', `Organizational hierarchy cannot exceed ${MAX_HIERARCHY_DEPTH} levels`);
          return false;
        }
      }

      // Validate employment status transitions
      if (mode === 'edit' && initialData?.employment_status) {
        const isValidTransition = await memberService.validateStatusTransition(
          initialData.employment_status,
          data.employment_status
        );
        if (!isValidTransition) {
          showNotification('error', 'Invalid employment status transition');
          return false;
        }
      }

      // Validate salary against organizational policies
      if (data.salary && policies?.salary_ranges) {
        const salaryRange = policies.salary_ranges[data.job_title];
        if (salaryRange && (data.salary < salaryRange.min || data.salary > salaryRange.max)) {
          showNotification('error', `Salary must be between ${salaryRange.min} and ${salaryRange.max} for this position`);
          return false;
        }
      }

      // Validate email uniqueness
      const emailExists = await memberService.checkEmailExists(data.email, memberId);
      if (emailExists) {
        showNotification('error', 'Email address is already in use');
        return false;
      }

      // Validate employee ID uniqueness
      const employeeIdExists = await memberService.checkEmployeeIdExists(data.employee_id, memberId);
      if (employeeIdExists) {
        showNotification('error', 'Employee ID is already in use');
        return false;
      }

      return true;
    } catch (error) {
      console.error('Business rule validation failed:', error);
      showNotification('error', 'Failed to validate business rules');
      return false;
    }
  }, [mode, initialData, memberId, policies, showNotification]);

  const handleSubmit = async (data: FormData) => {
    try {
      setIsSubmitting(true);

      // Validate business rules
      const isValid = await validateBusinessRules(data);
      if (!isValid) {
        setIsSubmitting(false);
        return;
      }

      // Prepare submission data
      const submissionData: MemberCreate | MemberUpdate = {
        ...data,
        organization_id: organizationId!
      };

      let result: Member;
      if (mode === 'create') {
        result = await memberService.createMember(submissionData as MemberCreate);
        showNotification('success', 'Member created successfully');
      } else {
        result = await memberService.updateMember(memberId!, submissionData as MemberUpdate);
        showNotification('success', 'Member updated successfully');
      }

      // Clear draft
      const draftKey = `member-form-draft-${memberId || 'new'}`;
      localStorage.removeItem(draftKey);

      // Refresh member list
      await refreshMembers();

      // Call parent callback
      onSubmit?.(result);
    } catch (error: any) {
      console.error('Form submission failed:', error);
      
      // Handle field-specific errors
      if (error.response?.data?.errors) {
        Object.entries(error.response.data.errors).forEach(([field, message]) => {
          // TODO: Set field-specific errors
        });
      }
      
      showNotification('error', error.message || 'Failed to save member');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowConfirmDialog(true);
    } else {
      onCancel?.();
    }
  }, [isDirty, onCancel]);

  const handleConfirmCancel = useCallback((action: 'save' | 'discard' | 'cancel') => {
    setShowConfirmDialog(false);
    
    if (action === 'save') {
      handleFormSubmit(handleSubmit)();
    } else if (action === 'discard') {
      // Clear draft
      const draftKey = `member-form-draft-${memberId || 'new'}`;
      localStorage.removeItem(draftKey);
      onCancel?.();
    }
  }, [handleFormSubmit, handleSubmit, memberId, onCancel]);

  const toggleSection = useCallback((section: keyof FormSectionState) => {
    setFormSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  }, []);

  const isViewMode = mode === 'view' || readOnly;

  return (
    <>
      <form ref={formRef} onSubmit={handleFormSubmit(handleSubmit)} className="member-form">
        {/* Personal Information Section */}
        <FormSection
          title="Personal Information"
          isOpen={formSections.personalInfo}
          onToggle={() => toggleSection('personalInfo')}
          required
        >
          <div className="form-grid">
            <Controller
              name="first_name"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  label="First Name"
                  required
                  disabled={isViewMode}
                  error={errors.first_name?.message}
                  aria-label="First Name"
                  autoComplete="given-name"
                />
              )}
            />
            
            <Controller
              name="last_name"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  label="Last Name"
                  required
                  disabled={isViewMode}
                  error={errors.last_name?.message}
                  aria-label="Last Name"
                  autoComplete="family-name"
                />
              )}
            />
            
            <Controller
              name="email"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="email"
                  label="Email"
                  required
                  disabled={isViewMode}
                  error={errors.email?.message}
                  aria-label="Email Address"
                  autoComplete="email"
                />
              )}
            />
            
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneInput
                  {...field}
                  label="Phone Number"
                  disabled={isViewMode}
                  error={errors.phone?.message}
                  aria-label="Phone Number"
                  autoComplete="tel"
                />
              )}
            />
            
            <Controller
              name="date_of_birth"
              control={control}
              render={({ field }) => (
                <DatePicker
                  {...field}
                  label="Date of Birth"
                  disabled={isViewMode}
                  error={errors.date_of_birth?.message}
                  maxDate={new Date()}
                  aria-label="Date of Birth"
                />
              )}
            />
            
            <Controller
              name="gender"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Gender"
                  disabled={isViewMode}
                  error={errors.gender?.message}
                  options={[
                    { value: Gender.MALE, label: 'Male' },
                    { value: Gender.FEMALE, label: 'Female' },
                    { value: Gender.OTHER, label: 'Other' },
                    { value: Gender.PREFER_NOT_TO_SAY, label: 'Prefer not to say' }
                  ]}
                  aria-label="Gender"
                />
              )}
            />
          </div>
          
          <div className="form-section-divider" />
          
          <AddressInput
            value={{
              street_address: watchedValues.street_address,
              city: watchedValues.city,
              state: watchedValues.state,
              postal_code: watchedValues.postal_code,
              country: watchedValues.country
            }}
            onChange={handleAddressChange}
            disabled={isViewMode}
            errors={{
              street_address: errors.street_address?.message,
              city: errors.city?.message,
              state: errors.state?.message,
              postal_code: errors.postal_code?.message,
              country: errors.country?.message
            }}
          />
        </FormSection>

        {/* Employment Information Section */}
        <FormSection
          title="Employment Information"
          isOpen={formSections.employmentInfo}
          onToggle={() => toggleSection('employmentInfo')}
          required
        >
          <div className="form-grid">
            <Controller
              name="employee_id"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  label="Employee ID"
                  required
                  disabled={isViewMode}
                  error={errors.employee_id?.message}
                  aria-label="Employee ID"
                />
              )}
            />
            
            <Controller
              name="job_title"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  label="Job Title"
                  required
                  disabled={isViewMode}
                  error={errors.job_title?.message}
                  aria-label="Job Title"
                  autoComplete="organization-title"
                />
              )}
            />
            
            <Controller
              name="department"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Department"
                  required
                  disabled={isViewMode}
                  error={errors.department?.message}
                  options={departmentOptions.map(dept => ({
                    value: dept.id,
                    label: dept.name
                  }))}
                  aria-label="Department"
                />
              )}
            />
            
            <div className="form-field-full">
              <label htmlFor="manager-search">Manager</label>
              <MemberSelector
                id="manager-search"
                value={watchedValues.manager_id}
                onChange={handleManagerSelect}
                searchQuery={managerSearchQuery}
                onSearchChange={setManagerSearchQuery}
                searchResults={managerSearchResults}
                isSearching={isSearchingManager}
                disabled={isViewMode || !allowManagerChange}
                placeholder="Search for manager..."
                aria-label="Manager"
              />
              {errors.manager_id && (
                <ValidationMessage message={errors.manager_id.message} />
              )}
            </div>
            
            <Controller
              name="employment_status"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Employment Status"
                  required
                  disabled={isViewMode}
                  error={errors.employment_status?.message}
                  options={[
                    { value: EmploymentStatus.ACTIVE, label: 'Active' },
                    { value: EmploymentStatus.INACTIVE, label: 'Inactive' },
                    { value: EmploymentStatus.ON_LEAVE, label: 'On Leave' },
                    { value: EmploymentStatus.TERMINATED, label: 'Terminated' }
                  ]}
                  aria-label="Employment Status"
                />
              )}
            />
            
            <Controller
              name="employment_type"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Employment Type"
                  required
                  disabled={isViewMode}
                  error={errors.employment_type?.message}
                  options={[
                    { value: EmploymentType.FULL_TIME, label: 'Full Time' },
                    { value: EmploymentType.PART_TIME, label: 'Part Time' },
                    { value: EmploymentType.CONTRACT, label: 'Contract' },
                    { value: EmploymentType.INTERN, label: 'Intern' },
                    { value: EmploymentType.CONSULTANT, label: 'Consultant' }
                  ]}
                  aria-label="Employment Type"
                />
              )}
            />
            
            <Controller
              name="hire_date"
              control={control}
              render={({ field }) => (
                <DatePicker
                  {...field}
                  label="Hire Date"
                  required
                  disabled={isViewMode}
                  error={errors.hire_date?.message}
                  maxDate={new Date()}
                  aria-label="Hire Date"
                />
              )}
            />
            
            {watchedValues.employment_status === EmploymentStatus.TERMINATED && (
              <Controller
                name="termination_date"
                control={control}
                render={({ field }) => (
                  <DatePicker
                    {...field}
                    label="Termination Date"
                    disabled={isViewMode}
                    error={errors.termination_date?.message}
                    minDate={watchedValues.hire_date ? parseISO(watchedValues.hire_date) : undefined}
                    maxDate={new Date()}
                    aria-label="Termination Date"
                  />
                )}
              />
            )}
            
            <Controller
              name="salary"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  type="number"
                  label="Salary"
                  disabled={isViewMode}
                  error={errors.salary?.message}
                  min={MIN_SALARY}
                  max={MAX_SALARY}
                  aria-label="Salary"
                />
              )}
            />
            
            <Controller
              name="salary_currency"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Currency"
                  disabled={isViewMode}
                  error={errors.salary_currency?.message}
                  options={[
                    { value: 'USD', label: 'USD' },
                    { value: 'EUR', label: 'EUR' },
                    { value: 'GBP', label: 'GBP' },
                    { value: 'JPY', label: 'JPY' }
                  ]}
                  aria-label="Salary Currency"
                />
              )}
            />
          </div>
          
          {showAdvancedFields && (
            <div className="organizational-chart-container">
              <OrganizationalChart
                memberId={watchedValues.id}
                managerId={watchedValues.manager_id}
                organizationId={organizationId}
                onSelectManager={handleManagerSelect}
                disabled={isViewMode}
              />
            </div>
          )}
        </FormSection>

        {/* Skills and Competencies Section */}
        {(showAdvancedFields || mode === 'edit') && (
          <FormSection
            title="Skills and Competencies"
            isOpen={formSections.skillsCompetencies}
            onToggle={() => toggleSection('skillsCompetencies')}
          >
            <Controller
              name="skills"
              control={control}
              render={({ field }) => (
                <SkillsInput
                  {...field}
                  label="Skills"
                  suggestions={skillSuggestions}
                  maxSkills={MAX_SKILLS}
                  disabled={isViewMode}
                  error={errors.skills?.message}
                  aria-label="Skills"
                />
              )}
            />
            
            {/* TODO: Add education, work experience, and certifications components */}
          </FormSection>
        )}

        {/* Contact and Personal Details Section */}
        {(showAdvancedFields || mode === 'edit') && (
          <FormSection
            title="Contact and Personal Details"
            isOpen={formSections.contactDetails}
            onToggle={() => toggleSection('contactDetails')}
          >
            <div className="profile-picture-section">
              <ProfilePictureUpload
                currentImageUrl={watchedValues.profile_picture_url}
                onUpload={handleProfilePictureUpload}
                disabled={isViewMode}
                maxSize={PROFILE_PICTURE_SIZE_LIMIT}
                aria-label="Profile Picture"
              />
            </div>
            
            <Controller
              name="bio"
              control={control}
              render={({ field }) => (
                <TextArea
                  {...field}
                  label="Bio"
                  rows={4}
                  maxLength={MAX_BIO_LENGTH}
                  disabled={isViewMode}
                  error={errors.bio?.message}
                  showCharCount
                  aria-label="Biography"
                />
              )}
            />
            
            <div className="emergency-contacts-section">
              <h4>Emergency Contacts</h4>
              {/* TODO: Add emergency contacts management component */}
            </div>
            
            <Controller
              name="timezone"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  label="Timezone"
                  disabled={isViewMode}
                  options={[
                    { value: 'UTC', label: 'UTC' },
                    { value: 'America/New_York', label: 'Eastern Time' },
                    { value: 'America/Chicago', label: 'Central Time' },
                    { value: 'America/Denver', label: 'Mountain Time' },
                    { value: 'America/Los_Angeles', label: 'Pacific Time' }
                  ]}
                  aria-label="Timezone"
                />
              )}
            />
            
            {/* TODO: Add languages, social links, and accessibility needs components */}
          </FormSection>
        )}

        {/* Form Actions */}
        {!isViewMode && (
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !isDirty}
              loading={isSubmitting}
            >
              {mode === 'create' ? 'Create Member' : 'Update Member'}
            </Button>
          </div>
        )}
      </form>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirmDialog}
        title="Unsaved Changes"
        message="You have unsaved changes. What would you like to do?"
        actions={[
          { label: 'Save Changes', value: 'save', variant: 'primary' },
          { label: 'Discard Changes', value: 'discard', variant: 'danger' },
          { label: 'Continue Editing', value: 'cancel', variant: 'secondary' }
        ]}
        onAction={handleConfirmCancel}
        onClose={() => setShowConfirmDialog(false)}
      />
    </>
  );
};

export default MemberForm;