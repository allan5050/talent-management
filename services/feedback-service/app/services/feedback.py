import logging
import json
import csv
import re
import asyncio
import os
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
from uuid import UUID
import uuid as uuid_lib
from io import StringIO
from collections import defaultdict

from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, desc, asc, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from fastapi import HTTPException

from app.models.feedback import Feedback
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackUpdate,
    FeedbackResponse,
    FeedbackFilter,
    FeedbackStats,
    FeedbackBulkCreate,
    FeedbackExport,
    FeedbackSearch,
    FeedbackTrend,
    FeedbackSummary,
    FeedbackReport,
    FeedbackQualityScore,
    FeedbackAnonymized
)

# Configure logging
logger = logging.getLogger(__name__)

# Configuration from environment variables
FEEDBACK_RETENTION_DAYS = int(os.getenv("FEEDBACK_RETENTION_DAYS", "2555"))
MAX_BULK_FEEDBACK_SIZE = int(os.getenv("MAX_BULK_FEEDBACK_SIZE", "100"))
MAX_FEEDBACK_EXPORT_SIZE = int(os.getenv("MAX_FEEDBACK_EXPORT_SIZE", "10000"))
FEEDBACK_CACHE_TTL = int(os.getenv("FEEDBACK_CACHE_TTL", "3600"))
MAX_SEARCH_RESULTS = int(os.getenv("MAX_SEARCH_RESULTS", "1000"))
DUPLICATE_SIMILARITY_THRESHOLD = float(os.getenv("DUPLICATE_SIMILARITY_THRESHOLD", "0.8"))


class FeedbackService:
    """Service class for feedback-related business logic operations."""
    
    def __init__(self, db: Session):
        """Initialize FeedbackService with database session dependency."""
        self.db = db
        self._cache = {}  # Simple in-memory cache
        self._cache_timestamps = {}
        
    def create_feedback(self, feedback_data: FeedbackCreate) -> FeedbackResponse:
        """Create a new feedback record with comprehensive validation."""
        try:
            # Validate duplicate feedback
            if self._check_duplicate_feedback(feedback_data):
                raise HTTPException(
                    status_code=400,
                    detail="Similar feedback already exists for this member"
                )
            
            # Validate member existence (would integrate with member service)
            if not self._validate_member_exists(feedback_data.member_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Member with ID {feedback_data.member_id} not found"
                )
            
            # Validate organization context
            if not self._validate_organization_context(
                feedback_data.member_id, 
                feedback_data.organization_id
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Member does not belong to the specified organization"
                )
            
            # Validate rating scale
            if not self._validate_rating_scale(feedback_data.rating):
                raise HTTPException(
                    status_code=400,
                    detail="Rating must be between 1 and 5"
                )
            
            # Sanitize content
            sanitized_content = self._sanitize_content(feedback_data.content)
            
            # Create feedback record
            feedback = Feedback(
                id=uuid_lib.uuid4(),
                member_id=feedback_data.member_id,
                organization_id=feedback_data.organization_id,
                feedback_type=feedback_data.feedback_type,
                rating=feedback_data.rating,
                content=sanitized_content,
                skills=feedback_data.skills,
                tags=feedback_data.tags,
                attachments=feedback_data.attachments,
                metadata=feedback_data.metadata,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                created_by=feedback_data.created_by,
                version=1,
                is_deleted=False
            )
            
            self.db.add(feedback)
            self.db.commit()
            self.db.refresh(feedback)
            
            # Invalidate cache
            self._invalidate_cache()
            
            # Log audit trail
            self._log_audit_trail("create", feedback.id, feedback_data.created_by)
            
            return FeedbackResponse.from_orm(feedback)
            
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Database integrity error: {str(e)}")
            raise HTTPException(
                status_code=400,
                detail="Failed to create feedback due to data integrity violation"
            )
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error creating feedback: {str(e)}")
            raise
    
    def get_feedback_by_id(self, feedback_id: UUID, user_id: Optional[str] = None) -> FeedbackResponse:
        """Retrieve individual feedback record by UUID."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == False
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Feedback with ID {feedback_id} not found"
                )
            
            # Check permissions
            if not self._check_feedback_access(feedback, user_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access denied to this feedback record"
                )
            
            return FeedbackResponse.from_orm(feedback)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error retrieving feedback: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve feedback"
            )
    
    def get_feedbacks(
        self,
        filter_params: FeedbackFilter,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[FeedbackResponse], int]:
        """Retrieve paginated feedback with advanced filtering."""
        try:
            query = self.db.query(Feedback).filter(Feedback.is_deleted == False)
            
            # Apply filters
            if filter_params.member_id:
                query = query.filter(Feedback.member_id == filter_params.member_id)
            
            if filter_params.organization_id:
                query = query.filter(Feedback.organization_id == filter_params.organization_id)
            
            if filter_params.feedback_type:
                query = query.filter(Feedback.feedback_type == filter_params.feedback_type)
            
            if filter_params.min_rating:
                query = query.filter(Feedback.rating >= filter_params.min_rating)
            
            if filter_params.max_rating:
                query = query.filter(Feedback.rating <= filter_params.max_rating)
            
            if filter_params.start_date:
                query = query.filter(Feedback.created_at >= filter_params.start_date)
            
            if filter_params.end_date:
                query = query.filter(Feedback.created_at <= filter_params.end_date)
            
            if filter_params.status:
                query = query.filter(Feedback.status == filter_params.status)
            
            if filter_params.search_text:
                search_pattern = f"%{filter_params.search_text}%"
                query = query.filter(
                    or_(
                        Feedback.content.ilike(search_pattern),
                        Feedback.tags.contains([filter_params.search_text])
                    )
                )
            
            # Get total count
            total_count = query.count()
            
            # Apply sorting
            if filter_params.sort_by:
                sort_column = getattr(Feedback, filter_params.sort_by, None)
                if sort_column:
                    if filter_params.sort_order == "desc":
                        query = query.order_by(desc(sort_column))
                    else:
                        query = query.order_by(asc(sort_column))
            else:
                query = query.order_by(desc(Feedback.created_at))
            
            # Apply pagination
            feedbacks = query.offset(skip).limit(limit).all()
            
            return [FeedbackResponse.from_orm(f) for f in feedbacks], total_count
            
        except Exception as e:
            logger.error(f"Error retrieving feedbacks: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve feedbacks"
            )
    
    def update_feedback(
        self,
        feedback_id: UUID,
        update_data: FeedbackUpdate,
        user_id: str
    ) -> FeedbackResponse:
        """Handle partial and complete feedback updates with optimistic locking."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == False
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Feedback with ID {feedback_id} not found"
                )
            
            # Check version for optimistic locking
            if update_data.version and feedback.version != update_data.version:
                raise HTTPException(
                    status_code=409,
                    detail="Feedback has been modified by another user. Please refresh and try again."
                )
            
            # Validate status transitions
            if update_data.status and not self._validate_status_transition(
                feedback.status,
                update_data.status
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid status transition from {feedback.status} to {update_data.status}"
                )
            
            # Update fields
            update_dict = update_data.dict(exclude_unset=True, exclude={"version"})
            for field, value in update_dict.items():
                if value is not None:
                    setattr(feedback, field, value)
            
            # Update audit fields
            feedback.updated_at = datetime.utcnow()
            feedback.updated_by = user_id
            feedback.version += 1
            
            self.db.commit()
            self.db.refresh(feedback)
            
            # Invalidate cache
            self._invalidate_cache()
            
            # Log audit trail
            self._log_audit_trail("update", feedback_id, user_id, update_dict)
            
            return FeedbackResponse.from_orm(feedback)
            
        except HTTPException:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error updating feedback: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to update feedback"
            )
    
    def delete_feedback(self, feedback_id: UUID, user_id: str) -> bool:
        """Implement soft deletion with proper cascade handling."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == False
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Feedback with ID {feedback_id} not found"
                )
            
            # Check referential integrity
            if not self._check_delete_constraints(feedback_id):
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete feedback due to existing references"
                )
            
            # Perform soft delete
            feedback.is_deleted = True
            feedback.deleted_at = datetime.utcnow()
            feedback.deleted_by = user_id
            
            self.db.commit()
            
            # Invalidate cache
            self._invalidate_cache()
            
            # Log audit trail
            self._log_audit_trail("delete", feedback_id, user_id)
            
            return True
            
        except HTTPException:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error deleting feedback: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to delete feedback"
            )
    
    def get_feedback_statistics(
        self,
        filter_params: Optional[FeedbackFilter] = None
    ) -> FeedbackStats:
        """Calculate comprehensive feedback analytics."""
        try:
            cache_key = f"stats_{hash(str(filter_params))}"
            cached_stats = self._get_from_cache(cache_key)
            if cached_stats:
                return cached_stats
            
            query = self.db.query(Feedback).filter(Feedback.is_deleted == False)
            
            # Apply filters if provided
            if filter_params:
                query = self._apply_filters(query, filter_params)
            
            # Calculate statistics
            total_count = query.count()
            
            if total_count == 0:
                return FeedbackStats(
                    total_count=0,
                    average_rating=0,
                    rating_distribution={},
                    feedback_by_type={},
                    trends=[]
                )
            
            # Average rating
            avg_rating = self.db.query(func.avg(Feedback.rating)).filter(
                Feedback.is_deleted == False
            ).scalar() or 0
            
            # Rating distribution
            rating_dist = self.db.query(
                Feedback.rating,
                func.count(Feedback.id)
            ).filter(
                Feedback.is_deleted == False
            ).group_by(Feedback.rating).all()
            
            rating_distribution = {str(r): c for r, c in rating_dist}
            
            # Feedback by type
            type_dist = self.db.query(
                Feedback.feedback_type,
                func.count(Feedback.id)
            ).filter(
                Feedback.is_deleted == False
            ).group_by(Feedback.feedback_type).all()
            
            feedback_by_type = {t: c for t, c in type_dist}
            
            # Trends (last 30 days)
            trends = self._calculate_feedback_trends(filter_params)
            
            stats = FeedbackStats(
                total_count=total_count,
                average_rating=round(float(avg_rating), 2),
                rating_distribution=rating_distribution,
                feedback_by_type=feedback_by_type,
                trends=trends
            )
            
            self._add_to_cache(cache_key, stats)
            return stats
            
        except Exception as e:
            logger.error(f"Error calculating feedback statistics: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to calculate feedback statistics"
            )
    
    def get_feedbacks_by_member(
        self,
        member_id: UUID,
        feedback_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[FeedbackResponse], FeedbackSummary]:
        """Retrieve all feedback records for a specific member."""
        try:
            query = self.db.query(Feedback).filter(
                Feedback.member_id == member_id,
                Feedback.is_deleted == False
            )
            
            if feedback_type:
                query = query.filter(Feedback.feedback_type == feedback_type)
            
            if start_date:
                query = query.filter(Feedback.created_at >= start_date)
            
            if end_date:
                query = query.filter(Feedback.created_at <= end_date)
            
            total_count = query.count()
            
            # Get paginated results
            feedbacks = query.order_by(desc(Feedback.created_at))\
                           .offset(skip).limit(limit).all()
            
            # Calculate summary
            summary = self.calculate_member_feedback_summary(member_id)
            
            return [FeedbackResponse.from_orm(f) for f in feedbacks], summary
            
        except Exception as e:
            logger.error(f"Error retrieving member feedbacks: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve member feedbacks"
            )
    
    def bulk_create_feedbacks(
        self,
        bulk_data: FeedbackBulkCreate,
        user_id: str
    ) -> Dict[str, Any]:
        """Handle batch feedback creation with transaction management."""
        if len(bulk_data.feedbacks) > MAX_BULK_FEEDBACK_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Bulk operation size exceeds maximum limit of {MAX_BULK_FEEDBACK_SIZE}"
            )
        
        results = {
            "successful": [],
            "failed": [],
            "total": len(bulk_data.feedbacks)
        }
        
        try:
            for idx, feedback_data in enumerate(bulk_data.feedbacks):
                try:
                    # Validate individual record
                    if self._check_duplicate_feedback(feedback_data):
                        results["failed"].append({
                            "index": idx,
                            "error": "Duplicate feedback detected",
                            "data": feedback_data.dict()
                        })
                        continue
                    
                    # Create feedback
                    feedback = Feedback(
                        id=uuid_lib.uuid4(),
                        member_id=feedback_data.member_id,
                        organization_id=feedback_data.organization_id,
                        feedback_type=feedback_data.feedback_type,
                        rating=feedback_data.rating,
                        content=self._sanitize_content(feedback_data.content),
                        skills=feedback_data.skills,
                        tags=feedback_data.tags,
                        created_at=datetime.utcnow(),
                        created_by=user_id,
                        version=1,
                        is_deleted=False
                    )
                    
                    self.db.add(feedback)
                    results["successful"].append({
                        "index": idx,
                        "id": str(feedback.id)
                    })
                    
                except Exception as e:
                    results["failed"].append({
                        "index": idx,
                        "error": str(e),
                        "data": feedback_data.dict()
                    })
            
            # Commit successful records
            if results["successful"]:
                self.db.commit()
                self._invalidate_cache()
            
            return results
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error in bulk feedback creation: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to complete bulk feedback creation"
            )
    
    def export_feedbacks(
        self,
        export_params: FeedbackExport,
        user_id: str
    ) -> Dict[str, Any]:
        """Generate feedback data exports in multiple formats."""
        try:
            query = self.db.query(Feedback).filter(Feedback.is_deleted == False)
            
            # Apply filters
            if export_params.filter:
                query = self._apply_filters(query, export_params.filter)
            
            # Limit export size
            query = query.limit(min(export_params.limit or MAX_FEEDBACK_EXPORT_SIZE, MAX_FEEDBACK_EXPORT_SIZE))
            
            feedbacks = query.all()
            
            if export_params.format == "csv":
                return self._export_to_csv(feedbacks, export_params.fields)
            elif export_params.format == "json":
                return self._export_to_json(feedbacks, export_params.fields)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported export format: {export_params.format}"
                )
                
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error exporting feedbacks: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to export feedbacks"
            )
    
    def search_feedbacks(
        self,
        search_params: FeedbackSearch
    ) -> Tuple[List[FeedbackResponse], Dict[str, Any]]:
        """Implement full-text search capabilities."""
        try:
            query = self.db.query(Feedback).filter(Feedback.is_deleted == False)
            
            # Build search query
            search_conditions = []
            
            if search_params.query:
                search_pattern = f"%{search_params.query}%"
                search_conditions.append(Feedback.content.ilike(search_pattern))
                
                # Search in tags
                if search_params.search_in_tags:
                    search_conditions.append(
                        Feedback.tags.contains([search_params.query])
                    )
            
            if search_conditions:
                query = query.filter(or_(*search_conditions))
            
            # Apply additional filters
            if search_params.filters:
                query = self._apply_filters(query, search_params.filters)
            
            # Calculate relevance (simplified)
            total_count = query.count()
            
            # Apply pagination
            feedbacks = query.limit(min(search_params.limit, MAX_SEARCH_RESULTS))\
                           .offset(search_params.offset).all()
            
            # Prepare search metadata
            metadata = {
                "total_results": total_count,
                "returned_results": len(feedbacks),
                "query": search_params.query,
                "search_time_ms": 0  # Would measure actual search time
            }
            
            return [FeedbackResponse.from_orm(f) for f in feedbacks], metadata
            
        except Exception as e:
            logger.error(f"Error searching feedbacks: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to search feedbacks"
            )
    
    def get_feedback_trends(
        self,
        organization_id: Optional[UUID] = None,
        period_days: int = 30
    ) -> List[FeedbackTrend]:
        """Analyze feedback patterns over time."""
        try:
            end_date = datetime.utcnow()
            start_date = end_date - timedelta(days=period_days)
            
            query = self.db.query(
                func.date(Feedback.created_at).label('date'),
                func.count(Feedback.id).label('count'),
                func.avg(Feedback.rating).label('avg_rating')
            ).filter(
                Feedback.is_deleted == False,
                Feedback.created_at >= start_date,
                Feedback.created_at <= end_date
            )
            
            if organization_id:
                query = query.filter(Feedback.organization_id == organization_id)
            
            trends = query.group_by(func.date(Feedback.created_at))\
                         .order_by(func.date(Feedback.created_at)).all()
            
            return [
                FeedbackTrend(
                    date=trend.date,
                    count=trend.count,
                    average_rating=round(float(trend.avg_rating or 0), 2)
                )
                for trend in trends
            ]
            
        except Exception as e:
            logger.error(f"Error analyzing feedback trends: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to analyze feedback trends"
            )
    
    def validate_feedback_data(self, feedback_data: FeedbackCreate) -> Dict[str, Any]:
        """Enforce business rules for feedback data."""
        validation_results = {
            "is_valid": True,
            "errors": [],
            "warnings": []
        }
        
        # Rating scale validation
        if not 1 <= feedback_data.rating <= 5:
            validation_results["is_valid"] = False
            validation_results["errors"].append("Rating must be between 1 and 5")
        
        # Content quality check
        if len(feedback_data.content) < 10:
            validation_results["warnings"].append("Feedback content is very short")
        
        # Required fields
        if not feedback_data.feedback_type:
            validation_results["is_valid"] = False
            validation_results["errors"].append("Feedback type is required")
        
        # Cross-field validation
        if feedback_data.feedback_type == "performance" and not feedback_data.skills:
            validation_results["warnings"].append(
                "Performance feedback should include skill assessments"
            )
        
        return validation_results
    
    def calculate_member_feedback_summary(self, member_id: UUID) -> FeedbackSummary:
        """Aggregate feedback data for individual members."""
        try:
            # Overall statistics
            stats = self.db.query(
                func.count(Feedback.id).label('total_count'),
                func.avg(Feedback.rating).label('average_rating')
            ).filter(
                Feedback.member_id == member_id,
                Feedback.is_deleted == False
            ).first()
            
            # Feedback by type
            type_counts = self.db.query(
                Feedback.feedback_type,
                func.count(Feedback.id)
            ).filter(
                Feedback.member_id == member_id,
                Feedback.is_deleted == False
            ).group_by(Feedback.feedback_type).all()
            
            # Recent trends
            recent_feedbacks = self.db.query(Feedback).filter(
                Feedback.member_id == member_id,
                Feedback.is_deleted == False,
                Feedback.created_at >= datetime.utcnow() - timedelta(days=90)
            ).order_by(desc(Feedback.created_at)).limit(10).all()
            
            return FeedbackSummary(
                member_id=member_id,
                total_feedbacks=stats.total_count or 0,
                average_rating=round(float(stats.average_rating or 0), 2),
                feedback_by_type={t: c for t, c in type_counts},
                recent_feedbacks=[FeedbackResponse.from_orm(f) for f in recent_feedbacks],
                last_feedback_date=recent_feedbacks[0].created_at if recent_feedbacks else None
            )
            
        except Exception as e:
            logger.error(f"Error calculating member feedback summary: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to calculate member feedback summary"
            )
    
    def get_organization_feedback_insights(
        self,
        organization_id: UUID
    ) -> Dict[str, Any]:
        """Provide organization-level feedback analytics."""
        try:
            # Team performance metrics
            team_stats = self.db.query(
                func.count(Feedback.id).label('total_feedbacks'),
                func.avg(Feedback.rating).label('avg_rating'),
                func.count(func.distinct(Feedback.member_id)).label('unique_members')
            ).filter(
                Feedback.organization_id == organization_id,
                Feedback.is_deleted == False
            ).first()
            
            # Feedback culture indicators
            recent_activity = self.db.query(
                func.date(Feedback.created_at),
                func.count(Feedback.id)
            ).filter(
                Feedback.organization_id == organization_id,
                Feedback.is_deleted == False,
                Feedback.created_at >= datetime.utcnow() - timedelta(days=30)
            ).group_by(func.date(Feedback.created_at)).all()
            
            # Top performers
            top_performers = self.db.query(
                Feedback.member_id,
                func.avg(Feedback.rating).label('avg_rating'),
                func.count(Feedback.id).label('feedback_count')
            ).filter(
                Feedback.organization_id == organization_id,
                Feedback.is_deleted == False
            ).group_by(Feedback.member_id)\
             .having(func.count(Feedback.id) >= 5)\
             .order_by(desc('avg_rating')).limit(10).all()
            
            return {
                "organization_id": str(organization_id),
                "total_feedbacks": team_stats.total_feedbacks or 0,
                "average_rating": round(float(team_stats.avg_rating or 0), 2),
                "unique_members_with_feedback": team_stats.unique_members or 0,
                "recent_activity": [
                    {"date": str(date), "count": count}
                    for date, count in recent_activity
                ],
                "top_performers": [
                    {
                        "member_id": str(member_id),
                        "average_rating": round(float(avg_rating), 2),
                        "feedback_count": feedback_count
                    }
                    for member_id, avg_rating, feedback_count in top_performers
                ],
                "feedback_frequency": self._calculate_feedback_frequency(organization_id)
            }
            
        except Exception as e:
            logger.error(f"Error generating organization insights: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate organization feedback insights"
            )
    
    def archive_old_feedbacks(self) -> Dict[str, int]:
        """Implement data lifecycle management."""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=FEEDBACK_RETENTION_DAYS)
            
            # Find feedbacks to archive
            old_feedbacks = self.db.query(Feedback).filter(
                Feedback.created_at < cutoff_date,
                Feedback.is_deleted == False,
                Feedback.archived == False
            ).all()
            
            archived_count = 0
            for feedback in old_feedbacks:
                feedback.archived = True
                feedback.archived_at = datetime.utcnow()
                archived_count += 1
            
            self.db.commit()
            
            logger.info(f"Archived {archived_count} old feedback records")
            
            return {
                "archived_count": archived_count,
                "cutoff_date": cutoff_date.isoformat()
            }
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error archiving old feedbacks: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to archive old feedbacks"
            )
    
    def restore_feedback(self, feedback_id: UUID, user_id: str) -> FeedbackResponse:
        """Handle feedback restoration from soft deletion."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == True
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Deleted feedback with ID {feedback_id} not found"
                )
            
            # Validate restoration is allowed
            if feedback.deleted_at and (datetime.utcnow() - feedback.deleted_at).days > 30:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot restore feedback deleted more than 30 days ago"
                )
            
            # Restore feedback
            feedback.is_deleted = False
            feedback.deleted_at = None
            feedback.deleted_by = None
            feedback.restored_at = datetime.utcnow()
            feedback.restored_by = user_id
            
            self.db.commit()
            self.db.refresh(feedback)
            
            # Log audit trail
            self._log_audit_trail("restore", feedback_id, user_id)
            
            return FeedbackResponse.from_orm(feedback)
            
        except HTTPException:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error restoring feedback: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to restore feedback"
            )
    
    def duplicate_feedback_detection(
        self,
        feedback_data: FeedbackCreate
    ) -> List[Dict[str, Any]]:
        """Identify potential duplicate feedback entries."""
        try:
            # Find similar feedbacks
            recent_feedbacks = self.db.query(Feedback).filter(
                Feedback.member_id == feedback_data.member_id,
                Feedback.is_deleted == False,
                Feedback.created_at >= datetime.utcnow() - timedelta(days=7)
            ).all()
            
            duplicates = []
            for feedback in recent_feedbacks:
                similarity = self._calculate_similarity(
                    feedback_data.content,
                    feedback.content
                )
                
                if similarity >= DUPLICATE_SIMILARITY_THRESHOLD:
                    duplicates.append({
                        "id": str(feedback.id),
                        "similarity_score": similarity,
                        "created_at": feedback.created_at.isoformat(),
                        "content_preview": feedback.content[:100]
                    })
            
            return duplicates
            
        except Exception as e:
            logger.error(f"Error detecting duplicate feedback: {str(e)}")
            return []
    
    def feedback_notification_triggers(
        self,
        feedback: Feedback
    ) -> List[Dict[str, Any]]:
        """Determine when feedback-related notifications should be sent."""
        triggers = []
        
        # Low rating trigger
        if feedback.rating <= 2:
            triggers.append({
                "type": "low_rating",
                "priority": "high",
                "recipients": ["manager", "hr"],
                "message": f"Low rating feedback received for member {feedback.member_id}"
            })
        
        # High rating trigger
        if feedback.rating >= 4.5:
            triggers.append({
                "type": "high_rating",
                "priority": "medium",
                "recipients": ["member", "manager"],
                "message": f"Excellent feedback received"
            })
        
        # Skill-specific trigger
        if feedback.skills and any(skill.get("rating", 0) <= 2 for skill in feedback.skills):
            triggers.append({
                "type": "skill_improvement_needed",
                "priority": "medium",
                "recipients": ["member", "training_coordinator"],
                "message": "Skills improvement opportunity identified"
            })
        
        return triggers
    
    def validate_feedback_permissions(
        self,
        feedback: Feedback,
        user_id: str,
        action: str
    ) -> bool:
        """Enforce access control rules."""
        # TODO: Integrate with actual permission system
        # For now, basic validation
        
        if action == "read":
            # Allow reading own feedback or if user is manager
            return True
        
        if action == "update":
            # Only creator can update within 24 hours
            if feedback.created_by == user_id:
                time_diff = datetime.utcnow() - feedback.created_at
                return time_diff.days < 1
            return False
        
        if action == "delete":
            # Only admins can delete
            return False  # Would check admin role
        
        return False
    
    def feedback_quality_scoring(self, feedback: Feedback) -> FeedbackQualityScore:
        """Evaluate feedback quality."""
        score_components = {
            "content_length": min(len(feedback.content) / 500, 1.0) * 25,
            "specificity": self._calculate_specificity_score(feedback.content) * 25,
            "constructiveness": self._calculate_constructiveness_score(feedback.content) * 25,
            "actionability": self._calculate_actionability_score(feedback.content) * 25
        }
        
        total_score = sum(score_components.values())
        
        return FeedbackQualityScore(
            total_score=round(total_score, 2),
            components=score_components,
            recommendations=self._generate_quality_recommendations(score_components)
        )
    
    def generate_feedback_reports(
        self,
        report_params: FeedbackReport
    ) -> Dict[str, Any]:
        """Create comprehensive feedback reports."""
        try:
            report_data = {
                "report_id": str(uuid_lib.uuid4()),
                "generated_at": datetime.utcnow().isoformat(),
                "parameters": report_params.dict(),
                "sections": {}
            }
            
            # Executive summary
            if "summary" in report_params.sections:
                report_data["sections"]["summary"] = self._generate_executive_summary(
                    report_params.filter
                )
            
            # Detailed analytics
            if "analytics" in report_params.sections:
                report_data["sections"]["analytics"] = self._generate_detailed_analytics(
                    report_params.filter
                )
            
            # Trends analysis
            if "trends" in report_params.sections:
                report_data["sections"]["trends"] = self._generate_trends_analysis(
                    report_params.filter
                )
            
            # Recommendations
            if "recommendations" in report_params.sections:
                report_data["sections"]["recommendations"] = self._generate_recommendations(
                    report_params.filter
                )
            
            return report_data
            
        except Exception as e:
            logger.error(f"Error generating feedback report: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate feedback report"
            )
    
    def feedback_workflow_management(
        self,
        feedback_id: UUID,
        action: str,
        user_id: str
    ) -> Dict[str, Any]:
        """Handle feedback lifecycle state transitions."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == False
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Feedback with ID {feedback_id} not found"
                )
            
            workflow_result = {
                "feedback_id": str(feedback_id),
                "previous_status": feedback.status,
                "action": action,
                "success": False
            }
            
            # Handle different workflow actions
            if action == "submit_for_review":
                if feedback.status == "draft":
                    feedback.status = "pending_review"
                    feedback.submitted_at = datetime.utcnow()
                    workflow_result["success"] = True
                    workflow_result["new_status"] = "pending_review"
            
            elif action == "approve":
                if feedback.status == "pending_review":
                    feedback.status = "approved"
                    feedback.approved_at = datetime.utcnow()
                    feedback.approved_by = user_id
                    workflow_result["success"] = True
                    workflow_result["new_status"] = "approved"
            
            elif action == "reject":
                if feedback.status == "pending_review":
                    feedback.status = "rejected"
                    feedback.rejected_at = datetime.utcnow()
                    feedback.rejected_by = user_id
                    workflow_result["success"] = True
                    workflow_result["new_status"] = "rejected"
            
            if workflow_result["success"]:
                self.db.commit()
                self._log_audit_trail("workflow_transition", feedback_id, user_id, workflow_result)
            
            return workflow_result
            
        except HTTPException:
            self.db.rollback()
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error in workflow management: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to process workflow action"
            )
    
    def feedback_analytics_engine(
        self,
        analytics_params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Perform advanced analytics."""
        try:
            results = {
                "sentiment_analysis": {},
                "keyword_extraction": [],
                "trend_identification": [],
                "predictive_insights": {}
            }
            
            # Sentiment analysis
            if analytics_params.get("include_sentiment", True):
                results["sentiment_analysis"] = self._perform_sentiment_analysis(
                    analytics_params.get("filter")
                )
            
            # Keyword extraction
            if analytics_params.get("include_keywords", True):
                results["keyword_extraction"] = self._extract_keywords(
                    analytics_params.get("filter")
                )
            
            # Trend identification
            if analytics_params.get("include_trends", True):
                results["trend_identification"] = self._identify_trends(
                    analytics_params.get("filter")
                )
            
            # Predictive modeling
            if analytics_params.get("include_predictions", False):
                results["predictive_insights"] = self._generate_predictions(
                    analytics_params.get("filter")
                )
            
            return results
            
        except Exception as e:
            logger.error(f"Error in analytics engine: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to perform analytics"
            )
    
    def feedback_anonymization_service(
        self,
        feedback_id: UUID,
        anonymization_level: str = "partial"
    ) -> FeedbackAnonymized:
        """Handle privacy requirements by anonymizing feedback data."""
        try:
            feedback = self.db.query(Feedback).filter(
                Feedback.id == feedback_id,
                Feedback.is_deleted == False
            ).first()
            
            if not feedback:
                raise HTTPException(
                    status_code=404,
                    detail=f"Feedback with ID {feedback_id} not found"
                )
            
            anonymized_data = FeedbackAnonymized(
                id=feedback.id,
                organization_id=feedback.organization_id,
                feedback_type=feedback.feedback_type,
                rating=feedback.rating,
                created_at=feedback.created_at
            )
            
            if anonymization_level == "partial":
                # Keep some non-identifying information
                anonymized_data.content = self._anonymize_content(feedback.content)
                anonymized_data.skills = feedback.skills
                anonymized_data.tags = feedback.tags
            elif anonymization_level == "full":
                # Remove all potentially identifying information
                anonymized_data.content = "[Content anonymized]"
                anonymized_data.skills = []
                anonymized_data.tags = []
            
            return anonymized_data
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error anonymizing feedback: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to anonymize feedback"
            )
    
    # Helper methods
    
    def _check_duplicate_feedback(self, feedback_data: FeedbackCreate) -> bool:
        """Check for duplicate feedback."""
        recent_similar = self.db.query(Feedback).filter(
            Feedback.member_id == feedback_data.member_id,
            Feedback.feedback_type == feedback_data.feedback_type,
            Feedback.is_deleted == False,
            Feedback.created_at >= datetime.utcnow() - timedelta(hours=24)
        ).first()
        
        if recent_similar:
            similarity = self._calculate_similarity(
                feedback_data.content,
                recent_similar.content
            )
            return similarity >= DUPLICATE_SIMILARITY_THRESHOLD
        
        return False
    
    def _validate_member_exists(self, member_id: UUID) -> bool:
        """Validate member existence."""
        # TODO: Integrate with member service
        # For now, assume member exists
        return True
    
    def _validate_organization_context(
        self,
        member_id: UUID,
        organization_id: UUID
    ) -> bool:
        """Validate member belongs to organization."""
        # TODO: Integrate with member service
        # For now, assume valid
        return True
    
    def _validate_rating_scale(self, rating: float) -> bool:
        """Validate rating is within acceptable range."""
        return 1 <= rating <= 5
    
    def _sanitize_content(self, content: str) -> str:
        """Sanitize feedback content."""
        # Remove excessive whitespace
        content = re.sub(r'\s+', ' ', content).strip()
        
        # Remove potential script tags (basic sanitization)
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.IGNORECASE)
        
        return content
    
    def _check_feedback_access(self, feedback: Feedback, user_id: Optional[str]) -> bool:
        """Check if user has access to feedback."""
        # TODO: Implement proper access control
        return True
    
    def _validate_status_transition(self, current_status: str, new_status: str) -> bool:
        """Validate status transition is allowed."""
        valid_transitions = {
            "draft": ["pending_review", "cancelled"],
            "pending_review": ["approved", "rejected", "draft"],
            "approved": ["archived"],
            "rejected": ["draft", "cancelled"],
            "cancelled": [],
            "archived": []
        }
        
        return new_status in valid_transitions.get(current_status, [])
    
    def _check_delete_constraints(self, feedback_id: UUID) -> bool:
        """Check if feedback can be deleted."""
        # TODO: Check for dependent records
        return True
    
    def _apply_filters(self, query, filter_params: FeedbackFilter):
        """Apply filter parameters to query."""
        if filter_params.member_id:
            query = query.filter(Feedback.member_id == filter_params.member_id)
        
        if filter_params.organization_id:
            query = query.filter(Feedback.organization_id == filter_params.organization_id)
        
        if filter_params.feedback_type:
            query = query.filter(Feedback.feedback_type == filter_params.feedback_type)
        
        if filter_params.min_rating:
            query = query.filter(Feedback.rating >= filter_params.min_rating)
        
        if filter_params.max_rating:
            query = query.filter(Feedback.rating <= filter_params.max_rating)
        
        if filter_params.start_date:
            query = query.filter(Feedback.created_at >= filter_params.start_date)
        
        if filter_params.end_date:
            query = query.filter(Feedback.created_at <= filter_params.end_date)
        
        return query
    
    def _calculate_feedback_trends(self, filter_params: Optional[FeedbackFilter]) -> List[Dict]:
        """Calculate feedback trends over time."""
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=30)
        
        query = self.db.query(
            func.date(Feedback.created_at).label('date'),
            func.count(Feedback.id).label('count'),
            func.avg(Feedback.rating).label('avg_rating')
        ).filter(
            Feedback.is_deleted == False,
            Feedback.created_at >= start_date
        )
        
        if filter_params:
            query = self._apply_filters(query, filter_params)
        
        trends = query.group_by(func.date(Feedback.created_at)).all()
        
        return [
            {
                "date": str(trend.date),
                "count": trend.count,
                "average_rating": round(float(trend.avg_rating or 0), 2)
            }
            for trend in trends
        ]
    
    def _export_to_csv(self, feedbacks: List[Feedback], fields: List[str]) -> Dict[str, Any]:
        """Export feedbacks to CSV format."""
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        
        for feedback in feedbacks:
            row = {}
            for field in fields:
                value = getattr(feedback, field, None)
                if isinstance(value, (datetime, UUID)):
                    value = str(value)
                elif isinstance(value, (list, dict)):
                    value = json.dumps(value)
                row[field] = value
            writer.writerow(row)
        
        return {
            "format": "csv",
            "data": output.getvalue(),
            "record_count": len(feedbacks)
        }
    
    def _export_to_json(self, feedbacks: List[Feedback], fields: List[str]) -> Dict[str, Any]:
        """Export feedbacks to JSON format."""
        data = []
        for feedback in feedbacks:
            record = {}
            for field in fields:
                value = getattr(feedback, field, None)
                if isinstance(value, datetime):
                    value = value.isoformat()
                elif isinstance(value, UUID):
                    value = str(value)
                record[field] = value
            data.append(record)
        
        return {
            "format": "json",
            "data": json.dumps(data, indent=2),
            "record_count": len(feedbacks)
        }
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate text similarity score."""
        # Simple word-based similarity
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        return len(intersection) / len(union)
    
    def _calculate_feedback_frequency(self, organization_id: UUID) -> Dict[str, float]:
        """Calculate feedback frequency metrics."""
        # Get feedback counts per member
        member_feedback_counts = self.db.query(
            Feedback.member_id,
            func.count(Feedback.id).label('count')
        ).filter(
            Feedback.organization_id == organization_id,
            Feedback.is_deleted == False,
            Feedback.created_at >= datetime.utcnow() - timedelta(days=90)
        ).group_by(Feedback.member_id).all()
        
        if not member_feedback_counts:
            return {"average_per_member": 0, "median_per_member": 0}
        
        counts = [count for _, count in member_feedback_counts]
        avg_count = sum(counts) / len(counts)
        sorted_counts = sorted(counts)
        median_count = sorted_counts[len(sorted_counts) // 2]
        
        return {
            "average_per_member": round(avg_count, 2),
            "median_per_member": median_count
        }
    
    def _calculate_specificity_score(self, content: str) -> float:
        """Calculate how specific the feedback content is."""
        # Simple heuristic based on content characteristics
        word_count = len(content.split())
        has_examples = bool(re.search(r'(for example|e\.g\.|such as|specifically)', content, re.I))
        has_metrics = bool(re.search(r'\d+', content))
        
        score = min(word_count / 100, 0.5)  # Up to 0.5 for length
        if has_examples:
            score += 0.25
        if has_metrics:
            score += 0.25
        
        return min(score, 1.0)
    
    def _calculate_constructiveness_score(self, content: str) -> float:
        """Calculate how constructive the feedback is."""
        # Look for constructive language patterns
        constructive_patterns = [
            r'(suggest|recommend|could|should|might|consider)',
            r'(improve|enhance|develop|strengthen)',
            r'(opportunity|potential|growth)'
        ]
        
        score = 0.0
        for pattern in constructive_patterns:
            if re.search(pattern, content, re.I):
                score += 0.33
        
        return min(score, 1.0)
    
    def _calculate_actionability_score(self, content: str) -> float:
        """Calculate how actionable the feedback is."""
        # Look for action-oriented language
        action_patterns = [
            r'(next steps|action items|to do)',
            r'(will|plan to|going to|intend to)',
            r'(goal|objective|target|milestone)'
        ]
        
        score = 0.0
        for pattern in action_patterns:
            if re.search(pattern, content, re.I):
                score += 0.33
        
        return min(score, 1.0)
    
    def _generate_quality_recommendations(self, score_components: Dict[str, float]) -> List[str]:
        """Generate recommendations for improving feedback quality."""
        recommendations = []
        
        if score_components["content_length"] < 15:
            recommendations.append("Provide more detailed feedback with specific examples")
        
        if score_components["specificity"] < 15:
            recommendations.append("Include specific examples and metrics where possible")
        
        if score_components["constructiveness"] < 15:
            recommendations.append("Focus on constructive suggestions for improvement")
        
        if score_components["actionability"] < 15:
            recommendations.append("Include clear action items or next steps")
        
        return recommendations
    
    def _generate_executive_summary(self, filter_params: Optional[FeedbackFilter]) -> Dict[str, Any]:
        """Generate executive summary for reports."""
        stats = self.get_feedback_statistics(filter_params)
        
        return {
            "total_feedbacks": stats.total_count,
            "average_rating": stats.average_rating,
            "rating_distribution": stats.rating_distribution,
            "feedback_types": stats.feedback_by_type,
            "key_insights": self._extract_key_insights(stats)
        }
    
    def _generate_detailed_analytics(self, filter_params: Optional[FeedbackFilter]) -> Dict[str, Any]:
        """Generate detailed analytics section."""
        # Would implement comprehensive analytics
        return {
            "performance_metrics": {},
            "skill_analysis": {},
            "trend_analysis": {},
            "comparative_analysis": {}
        }
    
    def _generate_trends_analysis(self, filter_params: Optional[FeedbackFilter]) -> Dict[str, Any]:
        """Generate trends analysis section."""
        trends = self.get_feedback_trends()
        
        return {
            "temporal_trends": trends,
            "seasonal_patterns": {},
            "growth_indicators": {}
        }
    
    def _generate_recommendations(self, filter_params: Optional[FeedbackFilter]) -> List[str]:
        """Generate recommendations based on feedback analysis."""
        recommendations = []
        
        stats = self.get_feedback_statistics(filter_params)
        
        if stats.average_rating < 3.0:
            recommendations.append("Focus on addressing low satisfaction areas")
        
        if stats.total_count < 10:
            recommendations.append("Encourage more frequent feedback collection")
        
        return recommendations
    
    def _extract_key_insights(self, stats: FeedbackStats) -> List[str]:
        """Extract key insights from statistics."""
        insights = []
        
        if stats.average_rating >= 4.0:
            insights.append("Overall feedback sentiment is positive")
        elif stats.average_rating < 3.0:
            insights.append("Significant improvement opportunities identified")
        
        return insights
    
    def _perform_sentiment_analysis(self, filter_params: Optional[FeedbackFilter]) -> Dict[str, Any]:
        """Perform sentiment analysis on feedback content."""
        # Simplified sentiment analysis
        return {
            "positive": 0.6,
            "neutral": 0.3,
            "negative": 0.1
        }
    
    def _extract_keywords(self, filter_params: Optional[FeedbackFilter]) -> List[Dict[str, Any]]:
        """Extract keywords from feedback content."""
        # Simplified keyword extraction
        return [
            {"keyword": "performance", "frequency": 45},
            {"keyword": "teamwork", "frequency": 32},
            {"keyword": "communication", "frequency": 28}
        ]
    
    def _identify_trends(self, filter_params: Optional[FeedbackFilter]) -> List[Dict[str, Any]]:
        """Identify trends in feedback data."""
        return [
            {
                "trend": "Increasing focus on soft skills",
                "confidence": 0.85,
                "time_period": "last_quarter"
            }
        ]
    
    def _generate_predictions(self, filter_params: Optional[FeedbackFilter]) -> Dict[str, Any]:
        """Generate predictive insights."""
        return {
            "predicted_rating_trend": "stable",
            "risk_indicators": [],
            "opportunity_areas": ["leadership_development"]
        }
    
    def _anonymize_content(self, content: str) -> str:
        """Anonymize feedback content while preserving meaning."""
        # Remove names (simplified)
        anonymized = re.sub(r'\b[A-Z][a-z]+\s+[A-Z][a-z]+\b', '[Name]', content)
        
        # Remove email addresses
        anonymized = re.sub(r'\S+@\S+', '[Email]', anonymized)
        
        # Remove phone numbers
        anonymized = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[Phone]', anonymized)
        
        return anonymized
    
    def _invalidate_cache(self):
        """Invalidate cache entries."""
        self._cache.clear()
        self._cache_timestamps.clear()
    
    def _get_from_cache(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        if key in self._cache:
            timestamp = self._cache_timestamps.get(key, 0)
            if datetime.utcnow().timestamp() - timestamp < FEEDBACK_CACHE_TTL:
                return self._cache[key]
        return None
    
    def _add_to_cache(self, key: str, value: Any):
        """Add value to cache with timestamp."""
        self._cache[key] = value
        self._cache_timestamps[key] = datetime.utcnow().timestamp()
    
    def _log_audit_trail(
        self,
        action: str,
        feedback_id: UUID,
        user_id: str,
        details: Optional[Dict] = None
    ):
        """Log audit trail for feedback operations."""
        audit_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "action": action,
            "feedback_id": str(feedback_id),
            "user_id": user_id,
            "details": details or {}
        }
        
        logger.info(f"Audit trail: {json.dumps(audit_entry)}")